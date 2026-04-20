/**
 * @file tests/playwright/signupfirstuser.spec.ts
 * @description Playwright end-to-end tests for first user signup and authentication flows in SveltyCMS.
 *   - Loads homepage and login screen
 *   - Verifies language selection updates UI
 *   - Signs up the first user and checks validations
 *   - Tests sign out, login, and forgot password flows
 */
import { expect, test, type Page } from "@playwright/test";

// test.describe.configure({ timeout: 60_000 }); // Set timeout for all tests

/** Dismiss the cookie consent modal if it appears after page load. */
async function dismissCookieConsent(page: Page) {
  await page.getByRole("button", { name: "Accept All" }).click({ timeout: 3000 }).catch(() => {});
}

test("Test loading homepage and login screen", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissCookieConsent(page);
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await dismissCookieConsent(page);

  await expect(page.getByText(/sign up/i)).toBeVisible();
  await expect(page.getByText(/sign in/i)).toBeVisible();
});

// ✅ Language selection test (custom Ark UI menu)
test("Check language selection updates UI text", async ({ page }) => {
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

// ✅ Signup First User
test("SignUp First User", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);
  await page.getByText(/sign up/i).click();

  // Username validation
  await page.locator("#usernamesignUp").fill("T");
  await page.locator("#usernamesignUp").press("Tab");
  await page.locator("#usernamesignUp").fill("Test");

  // Email validation
  await page.locator("#emailsignUp").fill("tes");
  await page.locator("#emailsignUp").fill("test@test2.de");

  // Password validation
  await page.locator("#passwordsignUp").fill("Test123");
  await page.locator("#passwordsignUp").press("Tab");

  await page.locator("#passwordsignUp").fill("Test123!");
  await page.locator("#confirm_passwordsignUp").fill("Test1234!");

  await page.locator("#confirm_passwordsignUp").fill("Test123!");

  // Registration Token (if required)
  await page.locator("#tokensignUp").fill("svelty-secret-key-32chars-padding!!");

  // Submit
  await page.locator('button[aria-label="Sign Up"]').click();

  // Final assert
  await expect(page).toHaveURL(/\/en\/Posts/);
});

// ✅ SignOut Test
test("SignOut after login", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);
  await page.getByText(/sign in/i).click();
  await page.getByTestId("signin-email").fill("test@test.de");
  await page.getByTestId("signin-password").fill("Test123!");
  await page.getByTestId("signin-submit").click();

  const signOutButton = page.locator('button[value="Sign out"]');
  if (await signOutButton.isVisible()) {
    await signOutButton.click();
    await expect(page).toHaveURL(/\/login/);
  }
});

// ✅ Login First User
test("Login First User", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);
  await page.getByText(/sign in/i).click();
  await page.getByTestId("signin-email").fill("test@test2.de");
  await page.getByTestId("signin-password").fill("Test123!");
  await page.getByTestId("signin-submit").click();

  await expect(page).toHaveURL(/\/en\/Posts/);
});

// ✅ Forgot Password
test("Forgot Password Flow", async ({ page }) => {
  await page.goto("/login");
  await dismissCookieConsent(page);
  await page.getByText(/sign in/i).click();
  await page.getByRole("button", { name: /forgotten password/i }).click();
  await page.locator("#emailforgot").fill("test@test2.de");
  await page.getByRole("button", { name: /send password reset email/i }).click();

  // Assume redirected to reset form
  await page.locator("#password").fill("Test123!");
  await page.locator("#confirm-password").fill("Test123!");
  await page.getByRole("button", { name: /save new password/i }).click();

  await expect(page).toHaveURL(/\/login/);
});
