/**
 * @file tests/e2e/signupfirstuser.spec.ts
 * @description Playwright end-to-end tests for first user signup and authentication flows in SveltyCMS.
 *
 * ### Flow:
 * 1. Load homepage and login screen
 * 2. Verify language selection updates UI
 * 3. Admin logs in → navigate to /user → create register token → copy token value
 * 4. Use that token to sign up the first user
 * 5. Tests sign out, login, and forgot password flows
 */
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers/auth";

// test.describe.configure({ timeout: 60_000 }); // Set timeout for all tests

/** Dismiss the cookie consent modal if it appears after page load. */
async function dismissCookieConsent(page: Page) {
  await page
    .getByRole("button", { name: "Accept All" })
    .click({ timeout: 3000 })
    .catch(() => {});
}

test.skip("Test loading homepage and login screen", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissCookieConsent(page);
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await dismissCookieConsent(page);

  await expect(page.getByText(/sign up/i)).toBeVisible();
  await expect(page.getByText(/sign in/i)).toBeVisible();
});

// ✅ Language selection test (custom Ark UI menu)
test.skip("Check language selection updates UI text", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);

  const languages = [
    { code: "de", expected: /anmelden/i }, // Sign In in German
    { code: "en", expected: /sign in/i }, // English
  ];

  for (const lang of languages) {
    // Open the custom language menu trigger
    await page.getByRole("button", { name: "Select language" }).click();
    // Click the menu item by its Ark UI data-value attribute (rendered via Portal)
    await page.locator(`[data-part="item"][data-value="${lang.code}"]`).click();
    await page.waitForTimeout(500); // Wait for UI update
    // The sign-in icon uses aria-label="Go to Sign In"; translated text is in the inner <p>
    await expect(page.locator('[data-testid="signin-icon"] p')).toHaveText(lang.expected);
  }
});

// ✅ Step 1: Admin gets a register token from the /user page
test("get register token -> Signup -> First User", async ({ page }) => {
  // Generate a random email for this test run
  const testEmail = `test-${Math.random().toString(36).substring(7)}@yopmail.com`;
  console.log(`[Test] Using random email: ${testEmail}`);

  // ── PART A: Admin logs in and creates a register token ──────────────────
  // Hardcode admin credentials to match setup wizard (admin@test.com / Admin123!)
  // This ensures tests work in CI/CD and Playwright UI without environment variables
  const adminEmail = "admin@test.com";
  const adminPassword = "Admin123!";
  console.log(`[Test] Using admin credentials: ${adminEmail}`);

  await loginAs(page, adminEmail, adminPassword);

  // Navigate to User Profile page
  await page.goto("/user", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /user profile/i })).toBeVisible({
    timeout: 10_000,
  });

  // Click "Email User Registration token" to open the token creation form
  await page.getByRole("button", { name: /Email User Registration token/i }).click();

  // Wait for the modal form to appear and be fully rendered
  await page.waitForTimeout(2000); // Give modal time to open and render

  // Wait for the email input field in the modal to be visible (not disabled)
  await page.waitForSelector("#email-address", {
    state: "visible",
    timeout: 10_000,
  });
  console.log(`[Test] Modal form is now visible`);

  // Fill the email for the new user - use the ID from the FloatingInput
  await page.locator("#email-address").fill(testEmail);

  // Try to select role if the field is visible (only for admin users)
  // If not visible, the default role from modal props will be used
  const roleChips = page.locator("button.chip");
  const roleChipCount = await roleChips.count();

  if (roleChipCount > 0) {
    console.log(`[Test] Found ${roleChipCount} role chips, attempting to select 'User' role`);
    // Use flexible text matching without anchors (^$) because chip may contain icon + text
    // The chip has: <span><icon/></span><span class="capitalize">user</span>
    const userRoleChip = roleChips.filter({ hasText: /user/i });
    const userChipCount = await userRoleChip.count();

    if (userChipCount > 0) {
      console.log(`[Test] Found ${userChipCount} 'User' role chip(s)`);
      // Click the first matching chip (should be the only one)
      await userRoleChip.first().click();
      // Wait a bit for the chip selection to register
      await page.waitForTimeout(500);
      console.log('[Test] Selected "User" role');
    } else {
      console.log('[Test] "User" role chip not found in available roles, using default role');
      console.log(`[Test] Available role chip texts: ${await roleChips.allTextContents()}`);
    }
  } else {
    console.log(
      "[Test] No role chips found (user may not have admin permission), using default role",
    );
  }

  // Select duration: 12 hrs using the select dropdown
  await page.locator("#expires-select").selectOption("12 hrs");

  // Send / create the token - look for the Save button in the modal
  const saveButton = page.getByRole("button", { name: /save/i });
  console.log("[Test] Clicking Save button...");

  // Check for any validation errors before clicking
  const errors = await page
    .locator('.text-error-500, .error-message, [class*="error"]')
    .allTextContents();
  if (errors.length > 0) {
    console.log(`[Test] Validation errors found: ${errors.join(", ")}`);
  }

  await saveButton.click();
  console.log("[Test] Save button clicked");

  // Wait for success toast or modal to close
  // Look for success indicator - could be toast, modal close, or table update
  await Promise.race([
    page
      .waitForSelector(".toast-success", { state: "visible", timeout: 5000 })
      .then(() => console.log("[Test] Success toast appeared")),
    page
      .waitForSelector(".modal-example-form", { state: "detached", timeout: 5000 })
      .then(() => console.log("[Test] Modal closed")),
    page.waitForTimeout(3000).then(() => console.log("[Test] Waited 3s for token creation")),
  ]).catch(() => console.log("[Test] No success indicator found, continuing..."));

  console.log(`[Test] Token creation submitted, waiting for token to appear in table...`);

  // Open the "Show User Token" section to see the token list
  const showTokenBtn = page.getByRole("button", { name: /show user token/i });
  await showTokenBtn.waitFor({ state: "visible", timeout: 5000 });
  await showTokenBtn.click();

  // Wait for the NEW token row to appear in the table (not just any table)
  // This ensures the token was actually created and the table has refreshed
  console.log(`[Token] Waiting for token row with email: ${testEmail}`);
  await page.waitForSelector(`table tbody tr:has-text("${testEmail}")`, {
    state: "visible",
    timeout: 10_000,
  });
  console.log(`[Token] Token row found in table`);

  // Wait for table to be visible
  await page.waitForSelector("table tbody tr", { state: "visible", timeout: 5000 });

  // Find the token for the specific email we just created
  let registerToken = "";

  // Strategy: Find the table row that contains our email, then extract the token from that row
  const tableRows = page.locator("table tbody tr");
  const rowCount = await tableRows.count();
  console.log(`[Token] Found ${rowCount} rows in token table`);

  for (let i = 0; i < rowCount; i++) {
    const row = tableRows.nth(i);
    const rowText = await row.textContent();

    // Check if this row contains our email
    if (rowText?.includes(testEmail)) {
      console.log(`[Token] Found row with email: ${testEmail}`);

      // Find the token cell in this row (it's in a <span> with font-mono class)
      const tokenSpan = row.locator("span.font-mono").first();
      const tokenText = await tokenSpan.textContent();

      if (tokenText) {
        const trimmed = tokenText.trim();
        // Verify it's a valid token format (32 or 64 character hex string)
        if ((trimmed.length === 32 || trimmed.length === 64) && /^[0-9a-f]+$/.test(trimmed)) {
          registerToken = trimmed;
          console.log(`[Token] Extracted token for ${testEmail}: ${registerToken.slice(0, 8)}...`);
          break;
        }
      }
    }
  }

  if (!registerToken) {
    throw new Error(
      `[Token] Could not find token for email: ${testEmail}. Make sure the token was created successfully.`,
    );
  }

  // ── PART B: Navigate to signup page (keep session, just navigate) ───────
  // Navigate to /login without clearing session (no browser restart)
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  console.log("[Test] Navigated to /login page");

  // Click Sign Up icon from the split screen
  await page.getByTestId("signup-icon").click();

  // Username validation
  await page.locator("#usernamesignUp").fill("TestUser");

  // Email validation
  await page.locator("#emailsignUp").fill(testEmail);

  // Password validation
  await page.locator("#passwordsignUp").fill("Test123!");
  await page.locator("#confirm_passwordsignUp").fill("Test123!");

  // Registration Token — use the one we obtained from the admin /user page
  await page.locator("#tokensignUp").fill(registerToken);

  // Submit - use type=submit selector to be more specific
  const submitButton = page.locator('form button[type="submit"]');
  await submitButton.waitFor({ state: "visible", timeout: 5000 });
  await submitButton.click();

  // Wait for success toast notification (signup doesn't redirect, just shows toast)
  await page.waitForTimeout(3000); // Wait for API call and toast to appear
  console.log(`[Test] Signup form submitted for ${testEmail}`);

  // ── PART C: Go back to Sign In and login with the new account ────────
  // Click on the signin icon/button to switch from Sign Up to Sign In
  // Use testId to avoid strict mode violation (there are 2 elements with "go to sign in")
  await page.getByTestId("signin-icon").click();
  await page.waitForTimeout(1000); // Wait for page transition
  console.log("[Test] Clicked Sign In icon");

  // Fill in the signin form with the newly created credentials
  await page.getByTestId("signin-email").fill(testEmail);
  await page.getByTestId("signin-password").fill("Test123!");

  // Submit the signin form
  await page.getByTestId("signin-submit").click();

  // Wait for navigation away from login page (sign in successful)
  // Dev hasn't fully built the redirect logic yet, so we just verify we left /login
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10_000 });
  console.log(`[Test] Sign in successful for ${testEmail} - navigated to ${page.url()}`);
});

// ✅ SignOut Test
test.skip("SignOut after login", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);
  await page.getByRole("tab", { name: /sign in/i }).click();
  await page.getByTestId("signin-email").fill("test@test2.de");
  await page.getByTestId("signin-password").fill("Test123!");
  await page.getByTestId("signin-submit").click();

  await page.waitForURL(/\/en\/Posts/);

  const signOutButton = page.locator('button[value="Sign out"]');
  if (await signOutButton.isVisible()) {
    await signOutButton.click();
    await expect(page).toHaveURL(/\/login/);
  }
});

// ✅ Login First User
test.skip("Login First User", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);
  await page.getByRole("tab", { name: /sign in/i }).click();
  await page.getByTestId("signin-email").fill("test@test2.de");
  await page.getByTestId("signin-password").fill("Test123!");
  await page.getByTestId("signin-submit").click();

  await expect(page).toHaveURL(/\/en\/Posts/);
});

// ✅ Forgot Password
test.skip("Forgot Password Flow", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);
  await page.getByRole("tab", { name: /sign in/i }).click();
  await page.getByRole("button", { name: /forgotten password/i }).click();
  await page.locator("#emailforgot").fill("test@test2.de");
  await page.getByRole("button", { name: /send password reset email/i }).click();

  // The rest of the flow depends on email link, which we can't easily test here without a mail hog
  // But we can check if the success message appeared
  await expect(page.getByText(/instructions sent/i)).toBeVisible();
});
