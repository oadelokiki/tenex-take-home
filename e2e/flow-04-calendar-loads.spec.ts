import { test, expect } from "@playwright/test";
import { e2eLoginBrowser } from "./helpers";

/**
 * Critical flow: authenticated user sees calendar events for the visible range (E2E mocks Google).
 * @see docs/HARNESS.md §13 — Flow 04
 */
test.describe("Flow 04 — Calendar loads", () => {
  test("shows fixture meeting after E2E session bootstrap", async ({ page, context }) => {
    await e2eLoginBrowser(context, page);
    await expect(page.getByText(/e2e-user@example\.com/i)).toBeVisible();
    await expect(page.getByText(/E2E fixture meeting/i)).toBeVisible({ timeout: 30_000 });
  });
});
