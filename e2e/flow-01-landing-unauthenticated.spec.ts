import { test, expect } from "@playwright/test";

/**
 * Critical flow: first visit — user is anonymous and sees the primary CTA.
 * @see docs/HARNESS.md §13 — Flow 01
 */
test.describe("Flow 01 — Landing (unauthenticated)", () => {
  test("shows Calendar Assistant title and Connect Google Calendar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Calendar Assistant/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Connect Google Calendar/i })).toBeVisible();
    await expect(page.getByText(/Sign in to load your primary calendar/i)).toBeVisible();
  });
});
