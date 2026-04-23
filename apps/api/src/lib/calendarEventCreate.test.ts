import { describe, expect, it } from "vitest";
import { calendarEventCreateBodySchema } from "./calendarEventCreate.js";

describe("calendarEventCreateBodySchema", () => {
  const validBase = {
    summary: "Team sync",
    description: "Weekly planning session.",
    start: "2026-05-01T15:00:00.000Z",
    end: "2026-05-01T16:00:00.000Z",
    attendees: ["alice@example.com", "bob@example.org"],
  };

  it("accepts a valid body", () => {
    const r = calendarEventCreateBodySchema.safeParse(validBase);
    expect(r.success).toBe(true);
  });

  it("rejects empty description", () => {
    const r = calendarEventCreateBodySchema.safeParse({ ...validBase, description: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects invalid attendee email", () => {
    const r = calendarEventCreateBodySchema.safeParse({
      ...validBase,
      attendees: ["not-an-email"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate attendee emails (case-insensitive)", () => {
    const r = calendarEventCreateBodySchema.safeParse({
      ...validBase,
      attendees: ["Alice@Example.com", "alice@example.com"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects end before or equal to start", () => {
    const r = calendarEventCreateBodySchema.safeParse({
      ...validBase,
      start: "2026-05-01T16:00:00.000Z",
      end: "2026-05-01T15:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 50 attendees", () => {
    const r = calendarEventCreateBodySchema.safeParse({
      ...validBase,
      attendees: Array.from({ length: 51 }, (_, i) => `u${i}@example.com`),
    });
    expect(r.success).toBe(false);
  });
});
