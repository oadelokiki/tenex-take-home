import { test, expect } from "@playwright/test";

/**
 * Critical flow: connect affordance points at same-origin OAuth start path (proxied to API).
 * @see docs/HARNESS.md §13 — Flow 02
 */
test.describe("Flow 02 — Connect link", () => {
  test("Connect link targets /auth/google", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: /Connect Google Calendar/i });
    await expect(link).toHaveAttribute("href", "/auth/google");
  });
});
