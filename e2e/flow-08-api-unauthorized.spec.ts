import { test, expect } from "@playwright/test";

/**
 * Critical flow: protected API routes reject requests without a valid app session.
 * @see docs/HARNESS.md §13 — Flow 08
 */
test.describe("Flow 08 — API unauthorized", () => {
  test("GET /api/calendar/events without session returns 401", async ({ request }) => {
    const res = await request.get(
      "/api/calendar/events?timeMin=2025-01-01T00:00:00.000Z&timeMax=2025-01-02T00:00:00.000Z",
    );
    expect(res.status()).toBe(401);
  });

  test("POST /api/chat without session returns 401", async ({ request }) => {
    const res = await request.post("/api/chat", {
      headers: { "content-type": "application/json" },
      data: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/calendar/events/validate without session returns 401", async ({ request }) => {
    const res = await request.post("/api/calendar/events/validate", {
      headers: { "content-type": "application/json" },
      data: {
        summary: "x",
        description: "y",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["a@b.com"],
      },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/calendar/events without session returns 401", async ({ request }) => {
    const res = await request.post("/api/calendar/events", {
      headers: { "content-type": "application/json" },
      data: {
        summary: "x",
        description: "y",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["a@b.com"],
      },
    });
    expect(res.status()).toBe(401);
  });
});
