import { test, expect } from "@playwright/test";

/**
 * Critical flow: health endpoint for orchestration / load checks.
 * @see docs/HARNESS.md §13 — Flow 09
 */
test.describe("Flow 09 — Health", () => {
  test("GET /health returns ok", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ ok: true });
  });
});
