import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "./scheduleEngine.js";
import {
  buildAssistantContextJson,
  capEventsForLlm,
  computeMeetingStats,
  isMeetingLike,
} from "./scheduleEngine.js";

describe("isMeetingLike", () => {
  it("detects attendee meetings", () => {
    expect(
      isMeetingLike({
        id: "1",
        summary: "Chat",
        start: "2025-01-01T10:00:00.000Z",
        end: "2025-01-01T11:00:00.000Z",
        attendees: ["a@x.com"],
      }),
    ).toBe(true);
  });

  it("treats focus blocks as non-meeting", () => {
    expect(
      isMeetingLike({
        id: "2",
        summary: "Focus time",
        start: "2025-01-01T09:00:00.000Z",
        end: "2025-01-01T12:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("computeMeetingStats", () => {
  it("sums hours", () => {
    const events: NormalizedEvent[] = [
      {
        id: "1",
        summary: "Standup",
        start: "2025-01-01T10:00:00.000Z",
        end: "2025-01-01T11:00:00.000Z",
        attendees: ["x@y.com"],
      },
      {
        id: "2",
        summary: "Focus",
        start: "2025-01-01T12:00:00.000Z",
        end: "2025-01-01T13:00:00.000Z",
      },
    ];
    const s = computeMeetingStats(events);
    expect(s.totalEventCount).toBe(2);
    expect(s.meetingLikeCount).toBe(1);
    expect(s.meetingBusyHours).toBe(1);
    expect(s.totalBusyHours).toBe(2);
  });
});

describe("capEventsForLlm", () => {
  it("truncates summaries and caps count", () => {
    const many: NormalizedEvent[] = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      summary: "x".repeat(200),
      start: "2025-01-01T10:00:00.000Z",
      end: "2025-01-01T11:00:00.000Z",
    }));
    const out = capEventsForLlm(many, 5, 10);
    expect(out).toHaveLength(5);
    expect(out[0].summary.endsWith("…")).toBe(true);
  });
});

describe("buildAssistantContextJson", () => {
  it("includes stats and note", () => {
    const json = buildAssistantContextJson({
      timeMin: "2025-01-01T00:00:00.000Z",
      timeMax: "2025-01-07T00:00:00.000Z",
      events: [],
      stats: {
        totalEventCount: 0,
        meetingLikeCount: 0,
        totalBusyHours: 0,
        meetingBusyHours: 0,
      },
      freeByDay: [],
    });
    expect(json).toContain("untrusted");
    expect(JSON.parse(json).stats.totalEventCount).toBe(0);
  });

  it("embeds clientClock when provided", () => {
    const json = buildAssistantContextJson({
      timeMin: "2025-01-01T00:00:00.000Z",
      timeMax: "2025-01-07T00:00:00.000Z",
      events: [],
      stats: {
        totalEventCount: 0,
        meetingLikeCount: 0,
        totalBusyHours: 0,
        meetingBusyHours: 0,
      },
      freeByDay: [],
      clientClock: {
        clientNowIso: "2025-01-15T12:00:00.000Z",
        ianaTimeZone: "UTC",
        localCalendarDate: "2025-01-15",
      },
    });
    const parsed = JSON.parse(json) as { clientClock?: Record<string, string> };
    expect(parsed.clientClock).toEqual({
      clientNowIso: "2025-01-15T12:00:00.000Z",
      ianaTimeZone: "UTC",
      localCalendarDate: "2025-01-15",
    });
  });
});
