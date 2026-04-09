/**
 * @file tests/playwright/setup-wizard.spec.ts
 * @description Setup wizard test for SveltyCMS
 *
 * This test completes the initial setup wizard by:
 * 1. Configuring database connection
 * 2. Creating the admin user account
 * 3. Initializing system defaults
 */

import { expect, test, type Page } from "@playwright/test";

// Helper to click "Next" button and wait for transition
async function clickNext(page: Page) {
  const nextButton = page.getByLabel("Next", { exact: true });
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
  await page.waitForTimeout(500); // Wait for stepper animation
}

test("Setup Wizard: Configure DB and Create Admin", async ({ page }) => {
  // Setup wizard can take time due to DB initialization/seeding
  test.setTimeout(120_000);

  // Enable TEST_MODE for the browser context if possible
  // Note: The server must already be started with TEST_MODE=true

  // 1. Start at root, expect redirect to /setup or /login
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");

  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);

  if (currentUrl.includes("/login")) {
    console.log("System already configured (at /login). Skipping setup.");
    return;
  }

  // If redirected elsewhere (e.g. root without setup), force go to /setup
  if (!currentUrl.includes("/setup")) {
    console.log("Redirected to non-setup page. Forcing navigate to /setup...");
    await page.goto("/setup", { waitUntil: "networkidle" });
  }

  // Wait for setup to load and hydrate
  await expect(page).toHaveURL(/\/setup/);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(5000); // Hard wait for page to fully render and modals to appear

  // Dismiss cookie consent banner if present (e.g. "Accept All")
  const cookieAcceptBtn = page.getByRole("button", { name: /accept all/i });
  if (await cookieAcceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Cookie consent banner detected. Clicking Accept All...');
    await cookieAcceptBtn.click();
    await page.waitForTimeout(300);
  }

  console.log("Starting setup wizard...");

  // Check for "Welcome to SveltyCMS" popup and click "Get Started" if present
  // NOTE: Skeleton v4 renders the modal twice (component tree + portal), so #welcome-heading
  // resolves to 2 elements. Use .first() to avoid strict mode violation.
  // Both positioners carry aria-hidden="true"; the ghost copy (c2) is fixed inset-0 and
  // physically intercepts pointer events over the real button (c1). Use { force: true }.
  const welcomeModal = page.locator('#welcome-heading').first();
  if (await welcomeModal.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Welcome to SveltyCMS popup detected. Clicking Get Started...');
    const getStartedBtn = page.locator('button').filter({ hasText: /get started/i }).first();
    await expect(getStartedBtn).toBeVisible({ timeout: 3000 });
    await getStartedBtn.click({ force: true }); // force: bypass ghost overlay interception
    await page.locator('#welcome-heading').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  console.log("Proceeding with setup steps...");

  // Dismiss any remaining generic overlays (dismiss/close)
  const dismissBtn = page.getByRole("button", { name: /^(dismiss|close)$/i });
  if (await dismissBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dismissBtn.click();
  }

  console.log("Starting Step 1: Database Configuration...");

  // --- STEP 1: Database ---
  await expect(page.locator("h2", { hasText: /database/i }).first()).toBeVisible({
    timeout: 30_000,
  });

  // Select Database Type if specified (default is sqlite for tests)
  const dbType = process.env.DB_TYPE || "sqlite";
  if (dbType !== "mongodb") {
    await page.locator("#db-type").selectOption(dbType);
  }

  // Fill credentials from ENV (CI) or Defaults (Local)
  const defaultPort = dbType === "mariadb" ? "3306" : dbType === "postgresql" ? "5432" : "27017";
  const dbHost =
    process.env.DB_HOST ||
    // SQLite uses filesystem paths, not hostnames
    (dbType === "sqlite" ? "config/database" : "localhost");
  const dbName =
    process.env.DB_NAME || (dbType === "sqlite" ? "SveltyCMS.db" : "sveltycms_test");
  const dbPort = process.env.DB_PORT || defaultPort;
  const dbUser =
    process.env.DB_USER !== undefined ? process.env.DB_USER : dbType === "sqlite" ? "" : "test";
  const dbPass =
    process.env.DB_PASSWORD !== undefined
      ? process.env.DB_PASSWORD
      : dbType === "sqlite"
        ? ""
        : "test";

  await page.locator("#db-host").fill(dbHost);
  await page.locator("#db-name").fill(dbName);

  // Cookie banner can appear late and steal clicks from setup controls.
  const lateCookieAcceptBtn = page.getByRole("button", { name: /accept all/i });
  if (await lateCookieAcceptBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await lateCookieAcceptBtn.click({ force: true });
    await page.waitForTimeout(300);
  }

  if (dbType !== "sqlite") {
    if (!page.url().includes("mongodb+srv")) {
      const portLocator = page.locator("#db-port");
      if (await portLocator.isVisible()) {
        await portLocator.fill(dbPort);
      }
    }

    const userLocator = page.locator("#db-user");
    if (await userLocator.isVisible()) {
      await userLocator.fill(dbUser);
    }

    const passLocator = page.locator("#db-password");
    if (await passLocator.isVisible()) {
      await passLocator.fill(dbPass);
    }
  }

  // Test Connection (with retry for CI stability)
  const testDbButton = page.locator("button", { hasText: /test database/i });
  await testDbButton.click({ force: true });

  // Handle "Database does not exist" confirmation for SQLite
  // Uses the label from messages/en.json: "Yes, Create It"
  const confirmBtn = page.getByRole("button", { name: /(yes|create)/i });
  if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("Database does not exist modal appeared. Clicking Yes...");
    await confirmBtn.first().click({ force: true });
    await page.waitForTimeout(400);
  }

  const nextButton = page.getByLabel("Next", { exact: true });
  try {
    // A reliable pass condition is that "Next" becomes enabled.
    await expect(nextButton).toBeEnabled({ timeout: 40_000 });
  } catch {
    console.log("Initial DB test failed, retrying once...");
    await page.waitForTimeout(5000);
    await testDbButton.click({ force: true });

    // Re-check for modal on retry
    if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmBtn.first().click({ force: true });
      await page.waitForTimeout(400);
    }

    await expect(nextButton).toBeEnabled({ timeout: 60_000 });
  }

  // Move to next step (clicking Next triggers database seeding which may take time)
  await clickNext(page);

  // --- STEP 2: Admin User ---
  await expect(page.locator("h2", { hasText: /admin/i }).first()).toBeVisible({
    timeout: 60_000,
  });

  // Fill admin user details
  await page.locator("#admin-username").fill(process.env.ADMIN_USER || "admin");
  await page.locator("#admin-email").fill(process.env.ADMIN_EMAIL || "admin@example.com");
  await page.locator("#admin-password").fill(process.env.ADMIN_PASS || "Admin123!");
  await page.locator("#admin-confirm-password").fill(process.env.ADMIN_PASS || "Admin123!");

  await clickNext(page);

  // --- STEPS 3-5: Defaults ---
  // Loop through remaining steps until "Complete" appears
  // This handles variable number of steps (Site settings, Email, etc.)
  for (let i = 0; i < 5; i++) {
    // Check for "Complete" button first (exact match avoids stepper indicator)
    const completeBtn = page.getByLabel("Complete", { exact: true });
    if (await completeBtn.isVisible()) {
      await completeBtn.click();
      break;
    }

    // Otherwise click Next
    const nextBtn = page.getByLabel("Next", { exact: true });
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }

  // --- VERIFICATION ---
  // 1. Force the server to recognize the setup is complete (bypasses restart requirement in CI)
  try {
    await page.request.post("/api/testing", {
      data: { action: "setup" },
    });
    console.log("Forced setup completion via API.");
  } catch (err) {
    console.warn("Could not call setup API (non-fatal):", err);
  }

  // 2. Expect redirect to Login or Dashboard
  await expect(page).not.toHaveURL(/\/setup/, { timeout: 30_000 });
  console.log("Setup completed successfully.");
});
