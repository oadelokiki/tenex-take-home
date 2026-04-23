import { describe, expect, it } from "vitest";
import {
  assertRangeWithinMaxDays,
  calendarQuerySchema,
} from "./calendarRange.js";

describe("calendarQuerySchema", () => {
  it("accepts valid ISO range", () => {
    const r = calendarQuerySchema.safeParse({
      timeMin: "2025-01-01T00:00:00.000Z",
      timeMax: "2025-01-02T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when timeMax <= timeMin", () => {
    const r = calendarQuerySchema.safeParse({
      timeMin: "2025-01-02T00:00:00.000Z",
      timeMax: "2025-01-01T00:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects absurdly long timestamp strings", () => {
    const pad = "x".repeat(100);
    const r = calendarQuerySchema.safeParse({
      timeMin: `2025-01-01T00:00:00.000Z${pad}`,
      timeMax: "2025-01-02T00:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });
});

describe("assertRangeWithinMaxDays", () => {
  it("throws when span exceeds max", () => {
    expect(() =>
      assertRangeWithinMaxDays(
        {
          timeMin: "2025-01-01T00:00:00.000Z",
          timeMax: "2025-03-15T00:00:00.000Z",
        },
        32,
      ),
    ).toThrow(/exceeds maximum/);
  });

  it("allows span within max", () => {
    expect(() =>
      assertRangeWithinMaxDays(
        {
          timeMin: "2025-01-01T00:00:00.000Z",
          timeMax: "2025-01-20T00:00:00.000Z",
        },
        32,
      ),
    ).not.toThrow();
  });
});
