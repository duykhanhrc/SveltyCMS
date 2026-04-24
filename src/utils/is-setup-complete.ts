/**
 * @file src/utils/is-setup-complete.ts
 * @description
 * Ultra-lightweight, zero-dependency utility to check if the CMS setup is complete.
 * This is used by vite.config.ts to avoid loading the full setup-check or database logic during boot.
 */

/**
 * Checks if the system setup is complete by verifying the presence of private.ts.
 * Safe for both server and browser environments.
 * @returns {boolean} True if setup is complete.
 */
export function isSetupComplete(): boolean {
  // Browser safety: if we are in the browser, we assume setup is handled by the server's redirect logic
  if (typeof window !== "undefined") return true;

  try {
    // Dynamic require to avoid bundling issues in the browser
    const fs = require("node:fs");
    const path = require("node:path");
    return fs.existsSync(path.join(process.cwd(), "config", "private.ts"));
  } catch {
    // Fallback if require or node modules are not available
    return false;
  }
}
