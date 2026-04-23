import { test, expect } from "@playwright/test";
import { e2eLogin } from "./helpers";

/**
 * Critical flow: API rejects calendar windows that exceed configured max span (abuse guard).
 * @see docs/HARNESS.md §13 — Flow 07
 */
test.describe("Flow 07 — Calendar range validation", () => {
  test("returns 400 when range exceeds CALENDAR_MAX_RANGE_DAYS", async ({ request }) => {
    await e2eLogin(request);
    const res = await request.get(
      "/api/calendar/events?timeMin=2020-01-01T00:00:00.000Z&timeMax=2020-06-01T00:00:00.000Z",
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(["range_error", "validation_error"]).toContain(body.error);
  });
});
