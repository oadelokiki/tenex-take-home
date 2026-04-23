import { describe, expect, it } from "vitest";
import { localCalendarDateInTimeZone } from "./clientClock.js";

describe("localCalendarDateInTimeZone", () => {
  it("uses IANA zone for the calendar date of an instant", () => {
    expect(localCalendarDateInTimeZone("2025-01-15T03:00:00.000Z", "America/New_York")).toBe(
      "2025-01-14",
    );
  });
});
