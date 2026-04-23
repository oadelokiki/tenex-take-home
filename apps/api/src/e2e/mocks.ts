import type { AppConfig } from "../lib/config.js";
import {
  createCalendarEvent as realCreateCalendarEvent,
  listEvents as realListEvents,
  type CreateCalendarEventInput,
  type CreatedCalendarEvent,
} from "../services/calendarService.js";
import { ollamaChat as realOllamaChat } from "../services/ollama.js";
export type E2eInjectedDeps = {
  listEvents: typeof realListEvents;
  createCalendarEvent: typeof realCreateCalendarEvent;
  ollamaChat: typeof realOllamaChat;
};

/** Returns one meeting-like event inside the requested window so week views always show it. */
export function getE2eMockDeps(): Pick<E2eInjectedDeps, "listEvents" | "createCalendarEvent" | "ollamaChat"> {
  return {
    listEvents: async (
      _refreshToken: string,
      _clientId: string,
      _clientSecret: string,
      _redirectUri: string,
      timeMin: string,
      timeMax: string,
    ) => {
      const t0 = new Date(timeMin).getTime();
      const t1 = new Date(timeMax).getTime();
      const midMs = Math.min(t0 + Math.floor((t1 - t0) / 2), t1 - 3_600_000);
      const start = new Date(midMs).toISOString();
      const end = new Date(midMs + 60 * 60 * 1000).toISOString();
      return [
        {
          id: "e2e-meeting",
          summary: "E2E fixture meeting",
          start,
          end,
          attendees: ["alice@example.com"],
          htmlLink: "https://calendar.google.com/e2e-fixture",
        },
      ];
    },
    createCalendarEvent: async (
      _refreshToken: string,
      _clientId: string,
      _clientSecret: string,
      _redirectUri: string,
      input: CreateCalendarEventInput,
    ): Promise<CreatedCalendarEvent> => ({
      id: `e2e-created-${Date.now()}`,
      summary: input.summary,
      description: input.description,
      start: input.start,
      end: input.end,
      htmlLink: "https://calendar.google.com/e2e-created",
      attendees: input.attendees.map((a) => a.email),
    }),
    ollamaChat: async (_config: AppConfig, messages) => {
      const last = messages.filter((m) => m.role === "user").pop()?.content ?? "";
      return `[E2E mock assistant] You asked: "${last.slice(0, 120)}".`;
    },
  };
}
