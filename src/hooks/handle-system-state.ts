/**
 * @file src/hooks/handle-system-state.ts
 * @description Middleware that acts as a gatekeeper, blocking or allowing requests based on the system's operational state.
 *
 * ### Features
 * - Integrates with the central state machine (`@stores/system`).
 * - Robust initialization with timeout protection
 * - Proper state machine with error recovery
 * - Prevents setup routes from returning before initialization
 */

import { dev } from "$app/environment";
import { dbInitPromise, getPrivateEnv } from "@src/databases/db";
import { metricsService } from "@src/services/metrics-service";
import { getSystemState, isSystemReady } from "@src/stores/system/state";
import type { SystemState } from "@src/stores/system/types";
import type { Handle, RequestEvent } from "@sveltejs/kit";
import { error } from "@sveltejs/kit";
import { AppError, handleApiError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { isBootstrapRoute, isSetupComplete } from "@utils/setup-check";
import { STATIC_ASSET_REGEX } from "./handle-static-asset-caching";

function isTrustedHost(event: RequestEvent): boolean {
  // Always trust any host if setup is not complete
  if (!isSetupComplete()) {
    return true;
  }

  const { host } = event.url;

  // Always trust localhost/loopback
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return true;
  }

  // Dynamic check for Demo Mode - allow any host to reach bootstrap routes
  // (Setup check happens in handleSetup anyway)
  const config = getPrivateEnv();
  if (config?.DEMO === true || process.env.SVELTYCMS_DEMO === "true") {
    return true;
  }

  // Use environment variables for strict host validation during bootstrap
  // We avoid DB settings here as they might not be loaded yet
  const hostDev = process.env.HOST_DEV;
  const hostProd = process.env.HOST_PROD;
  const origin = process.env.ORIGIN;

  // If ORIGIN is set (common in production), extract host from it
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (host === originHost) return true;
    } catch {
      // Ignore invalid URL in ORIGIN
    }
  }

  const trustedHost = dev ? hostDev : hostProd;

  if (trustedHost && host === trustedHost) {
    return true;
  }

  // If no host is configured yet, we only allowed localhost (fail-safe)
  return false;
}

// Color helper for state values
function colorState(state: string): string {
  const colors: Record<string, string> = {
    IDLE: "\x1b[90m", // Gray
    INITIALIZING: "\x1b[33m", // Yellow
    WARMING: "\x1b[33m", // Yellow
    WARMED: "\x1b[36m", // Cyan
    READY: "\x1b[32m", // Green
    DEGRADED: "\x1b[31m", // Red
    FAILED: "\x1b[31m", // Red
    SETUP: "\x1b[35m", // Magenta
    pending: "\x1b[33m", // Yellow
    "in-progress": "\x1b[33m", // Yellow
    complete: "\x1b[32m", // Green
    failed: "\x1b[31m", // Red
  };
  const color = colors[state] || "\x1b[0m";
  const reset = "\x1b[0m";
  return `${color}${state}${reset}`;
}

// Color helper for paths
function colorPath(path: string): string {
  return `\x1b[33m${path}\x1b[0m`; // Yellow
}

// Track initialization state more robustly
let initializationState: "pending" | "in-progress" | "complete" | "failed" = "pending";
let initError: Error | null = null;
let initStartTime = 0;

// Timeout protection (60 seconds max for initialization)
const INIT_TIMEOUT_MS = 60_000;

/**
 * RESET initialization state for testing
 */
export const resetInitializationState = () => {
  initializationState = "pending";
  initError = null;
  initStartTime = 0;
};

export const handleSystemState: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const setupComplete = isSetupComplete();

  let systemState = getSystemState();

  // Skip trace logging and heavy logic for static assets and health checks
  const isHealthCheck =
    pathname.startsWith("/api/system/health") || pathname.startsWith("/api/dashboard/health");
  const isAsset = STATIC_ASSET_REGEX.test(pathname);

  if (isAsset) {
    return await resolve(event);
  }

  if (!isHealthCheck) {
    const requestType = event.isDataRequest ? "API" : "PAGE";
    logger.debug(
      `[handleSystemState] ${event.request.method} ${colorPath(pathname)}${event.url.search} [${requestType}], state: ${colorState(systemState.overallState)}, initState: ${colorState(initializationState)}`,
    );
  }

  // Bypass state checks in TEST_MODE
  if (process.env.TEST_MODE === "true") {
    if (!isHealthCheck) {
      logger.warn(`[handleSystemState] TEST_MODE enabled. Bypassing state checks for ${pathname}`);
    }
    return await resolve(event);
  }

  try {
    // --- Phase 1: Attempt Initialization (if needed) ---
    if (systemState.overallState === "IDLE") {
      if (initializationState === "pending") {
        if (setupComplete) {
          initializationState = "in-progress";
          initStartTime = Date.now();
          logger.info("System is IDLE and setup is complete. Starting initialization...");

          // 🚀 OPTIMIZATION: Don't block the first byte for bootstrap page requests!
          const initPromise = (async () => {
            try {
              await Promise.race([
                dbInitPromise,
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Initialization timeout")), INIT_TIMEOUT_MS),
                ),
              ]);
              initializationState = "complete";
            } catch (err) {
              initializationState = "failed";
              initError = err instanceof Error ? err : new Error(String(err));
              logger.error("Initialization failed:", initError);
            }
          })();

          if (!event.isDataRequest && isBootstrapRoute(pathname)) {
            logger.debug(`[handleSystemState] Fast-tracking bootstrap page: ${pathname}`);
          } else {
            await initPromise;
            if ((initializationState as string) === "failed") {
              throw new AppError("Service initialization failed.", 503, "INIT_FAILED");
            }
          }
        } else {
          initializationState = "complete";
        }
      } else if (initializationState === "in-progress") {
        if (!event.isDataRequest && isBootstrapRoute(pathname)) {
          // Fast-track bootstrap page
        } else {
          const elapsed = Date.now() - initStartTime;
          if (elapsed > INIT_TIMEOUT_MS) {
            initializationState = "failed";
            throw new AppError("Initialization timeout", 503, "INIT_TIMEOUT");
          }
          await dbInitPromise;
        }
      } else if (initializationState === "failed") {
        // Self-Healing: Check if we should retry initialization
        const RETRY_COOLDOWN_MS = 5000;
        const timeSinceFailure = Date.now() - (initStartTime || 0);

        if (timeSinceFailure > RETRY_COOLDOWN_MS) {
          logger.info(`[Self-Healing] Attempting recovery...`);
          initializationState = "in-progress";
          initStartTime = Date.now();

          try {
            const { resetDbInitPromise, getDbInitPromise } = await import("@src/databases/db");
            resetDbInitPromise();
            const newPromise = getDbInitPromise(true);

            await Promise.race([
              newPromise,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Recovery timeout")), INIT_TIMEOUT_MS),
              ),
            ]);
            initializationState = "complete";
            initError = null;
            logger.info("[Self-Healing] System successfully recovered.");
          } catch (recoveryErr) {
            initializationState = "failed";
            initError = recoveryErr instanceof Error ? recoveryErr : new Error(String(recoveryErr));
            logger.error(`[Self-Healing] System recovery failed: ${initError.message}`);
            throw new AppError("System recovery failed.", 503, "RECOVERY_FAILED");
          }
        } else {
          throw new AppError(
            `System starting up... (${Math.ceil((RETRY_COOLDOWN_MS - timeSinceFailure) / 1000)}s)`,
            503,
            "INIT_COOLDOWN",
          );
        }
      }
      // Re-fetch state
      systemState = getSystemState();
    }
    // If 'complete', continue to route checks below

    // --- Phase 2: Handle Bootstrap Routes (Restricted States) ---
    // These routes are allowed during IDLE, INITIALIZING, or SETUP if host is trusted.
    if (isBootstrapRoute(pathname)) {
      // SECURITY: Enforce host validation for bootstrap routes during restricted states
      if (!isTrustedHost(event)) {
        metricsService.incrementSecurityViolations();
        logger.warn(
          `Untrusted host ${colorPath(event.url.host)} attempted bootstrap access to ${colorPath(pathname)} during state: ${colorState(systemState.overallState)}`,
        );
        throw new AppError("Forbidden: Access from untrusted host blocked.", 403, "UNTRUSTED_HOST");
      }

      // Special handling for root redirect in SETUP mode
      if (pathname === "/" && systemState.overallState === "SETUP") {
        logger.info("System in SETUP mode. Redirecting root to /setup");
        return new Response(null, {
          status: 302,
          headers: { Location: "/setup" },
        });
      }

      logger.trace(
        `Allowing bootstrap request to ${pathname} during ${systemState.overallState} state.`,
      );
      return await resolve(event);
    }

    // --- State: INITIALIZING ---
    if (systemState.overallState === "INITIALIZING") {
      // Wait for initialization to complete with timeout
      logger.debug(`Request to ${pathname} waiting for initialization to complete...`);
      try {
        await Promise.race([
          dbInitPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Init wait timeout")), INIT_TIMEOUT_MS),
          ),
        ]);
        systemState = getSystemState();
        logger.debug(`Initialization complete. System state is now: ${systemState.overallState}`);
      } catch (err) {
        logger.error("Initialization wait error:", err);
        throw new AppError(
          "Service Unavailable: System initialization failed.",
          503,
          "INIT_FAILED_WAIT",
        );
      }

      // If still not ready after initialization, block the request
      if (!isSystemReady()) {
        logger.warn(`Request to ${pathname} blocked: System failed to initialize properly.`);
        throw new AppError(
          "Service Unavailable: The system failed to initialize. Please contact an administrator.",
          503,
          "SYSTEM_NOT_READY",
        );
      }
    }

    // --- Phase 4: Handle Restricted States ---
    // If we reached here, it means it's NOT a bootstrap route (already resolved above).
    const restrictedStates: SystemState[] = [
      "IDLE",
      "INITIALIZING",
      "SETUP",
      "MAINTENANCE",
      "FAILED",
    ];
    if (restrictedStates.includes(systemState.overallState as any)) {
      if (systemState.overallState === "SETUP") {
        logger.warn(`Request to ${pathname} blocked: System is in SETUP mode.`);
        throw new AppError(
          "System is in Setup Mode. Please complete configuration.",
          503,
          "SYSTEM_SETUP_MODE",
        );
      }
      if (systemState.overallState === "MAINTENANCE") {
        logger.warn(`Request to ${pathname} blocked: System is in MAINTENANCE mode.`);
        throw new AppError(
          "System is currently under maintenance. Please try again later.",
          503,
          "SYSTEM_MAINTENANCE",
        );
      }

      logger.warn(
        `Request to ${pathname} blocked: System is currently ${systemState.overallState}.`,
      );
      throw new AppError(
        `Service Unavailable: System is currently ${systemState.overallState}.`,
        503,
        "SYSTEM_RESTRICTED",
      );
    }

    // --- State: Final Ready Check (Warming Phase) ---
    const isNowReady =
      systemState.overallState === "READY" ||
      systemState.overallState === "DEGRADED" ||
      systemState.overallState === "WARMING" ||
      systemState.overallState === "WARMED";

    if (!isNowReady) {
      // Reduce log noise for well-known/devtools requests
      if (pathname.startsWith("/.well-known/") || pathname.includes("devtools")) {
        logger.trace(
          `Request to ${pathname} blocked: System is currently ${systemState.overallState}.`,
        );
      } else {
        logger.warn(
          `Request to ${pathname} blocked: System is currently ${systemState.overallState}.`,
        );
      }
      throw new AppError(
        "Service Unavailable: The system is starting up. Please try again in a moment.",
        503,
        "SYSTEM_STARTING_UP",
      );
    }

    // --- State: READY or DEGRADED ---
    if (systemState.overallState === "READY" || systemState.overallState === "DEGRADED") {
      if (systemState.overallState === "DEGRADED") {
        const degradedServices = Object.entries(systemState.services)
          .filter(([, s]) => s.status === "unhealthy")
          .map(([name]) => name);

        if (degradedServices.length > 0) {
          event.locals.degradedServices = degradedServices;
          logger.warn(
            `Request to ${pathname} is proceeding in a DEGRADED state. Unhealthy services: ${degradedServices.join(", ")}`,
          );
        }
      }
    }

    return await resolve(event);
  } catch (err) {
    if (pathname.startsWith("/api/")) {
      return handleApiError(err, event);
    }

    if (err instanceof AppError) {
      throw error(err.status, err.message);
    }

    throw err;
  }
};
