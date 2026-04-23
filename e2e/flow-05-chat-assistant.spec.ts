import { test, expect } from "@playwright/test";
import { e2eLoginBrowser } from "./helpers";

/**
 * Critical flow: user sends a chat message and receives an assistant reply (E2E mocks Ollama).
 * @see docs/HARNESS.md §13 — Flow 05
 */
test.describe("Flow 05 — Chat assistant", () => {
  test("assistant responds with E2E mock prefix", async ({ page, context }) => {
    await e2eLoginBrowser(context, page);
    const input = page.locator(".chat-form textarea");
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await input.fill("How busy is my week?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".chat-msg-assistant").getByText(/\[E2E mock assistant\]/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".chat-msg-user").getByText(/How busy is my week/i)).toBeVisible();
  });
});
