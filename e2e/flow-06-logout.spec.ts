import { test, expect } from "@playwright/test";
import { e2eLoginBrowser } from "./helpers";

/**
 * Critical flow: user signs out and returns to anonymous landing state.
 * @see docs/HARNESS.md §13 — Flow 06
 */
test.describe("Flow 06 — Logout", () => {
  test("Sign out shows Connect Google Calendar again", async ({ page, context }) => {
    await e2eLoginBrowser(context, page);
    await page.getByRole("button", { name: /Sign out/i }).click();
    await expect(page.getByRole("link", { name: /Connect Google Calendar/i })).toBeVisible();
    await expect(page.getByText(/e2e-user@example\.com/i)).not.toBeVisible();
  });
});
