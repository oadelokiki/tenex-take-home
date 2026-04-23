import { describe, expect, it, beforeEach } from "vitest";
import { buildApp } from "./app.js";
import type { AppStores } from "./lib/appStores.js";
import { TENEX_SESSION_COOKIE } from "./lib/sessionConstants.js";
import { OAuthPendingStore } from "./lib/oauthPendingStore.js";
import { SessionStore } from "./lib/sessionStore.js";
import { testConfig } from "./test/fixtures.js";
import type { NormalizedEvent } from "./services/scheduleEngine.js";
import type { ChatMessage } from "./services/ollama.js";

describe("buildApp HTTP", () => {
  const config = testConfig();
  let stores: AppStores;

  beforeEach(() => {
    stores = {
      sessions: new SessionStore(),
      oauthPending: new OAuthPendingStore(),
    };
  });

  it("GET /health", async () => {
    const app = await buildApp(config, stores);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    await app.close();
  });

  it("GET /api/session unauthenticated", async () => {
    const app = await buildApp(config, stores);
    const res = await app.inject({ method: "GET", url: "/api/session" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).authenticated).toBe(false);
    await app.close();
  });

  it("GET /api/calendar/events 401 without session", async () => {
    const app = await buildApp(config, stores);
    const res = await app.inject({
      method: "GET",
      url: "/api/calendar/events?timeMin=2025-01-01T00:00:00.000Z&timeMax=2025-01-02T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /api/calendar/events 401 without session", async () => {
    const app = await buildApp(config, stores);
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        summary: "x",
        description: "y",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["a@b.com"],
      }),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /api/calendar/events/validate 401 without session", async () => {
    const app = await buildApp(config, stores);
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events/validate",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        summary: "x",
        description: "y",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["a@b.com"],
      }),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /api/calendar/events/validate 200 with session + valid body", async () => {
    const app = await buildApp(config, stores);
    const sid = stores.sessions.create({
      googleRefreshToken: "fake",
      email: "u@example.com",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events/validate",
      headers: {
        "content-type": "application/json",
        cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}`,
      },
      payload: JSON.stringify({
        summary: "S",
        description: "D",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["a@b.com"],
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; event: { summary: string } };
    expect(body.ok).toBe(true);
    expect(body.event.summary).toBe("S");
    await app.close();
  });

  it("POST /api/calendar/events/validate 400 on invalid body", async () => {
    const app = await buildApp(config, stores);
    const sid = stores.sessions.create({
      googleRefreshToken: "fake",
      email: "u@example.com",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events/validate",
      headers: {
        "content-type": "application/json",
        cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}`,
      },
      payload: JSON.stringify({
        summary: "S",
        description: "   ",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["a@b.com"],
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { ok: boolean };
    expect(body.ok).toBe(false);
    await app.close();
  });

  it("POST /api/calendar/events 400 on duplicate attendees", async () => {
    const app = await buildApp(config, stores, {
      createCalendarEvent: async () => {
        throw new Error("should not call Google");
      },
    });
    const sid = stores.sessions.create({
      googleRefreshToken: "fake",
      email: "u@example.com",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events",
      headers: {
        "content-type": "application/json",
        cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}`,
      },
      payload: JSON.stringify({
        summary: "S",
        description: "A real description here.",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["x@y.com", "x@y.com"],
      }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /api/calendar/events 201 with mock create", async () => {
    const app = await buildApp(config, stores, {
      createCalendarEvent: async (_rt, _cid, _cs, _ru, input) => ({
        id: "created-1",
        summary: input.summary,
        description: input.description,
        start: input.start,
        end: input.end,
        htmlLink: "https://calendar.example/event",
        attendees: input.attendees.map((a) => a.email),
      }),
    });
    const sid = stores.sessions.create({
      googleRefreshToken: "fake",
      email: "u@example.com",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events",
      headers: {
        "content-type": "application/json",
        cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}`,
      },
      payload: JSON.stringify({
        summary: "Q1 review",
        description: "Agenda in room A.",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["peer@example.com"],
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { event: { id: string; summary: string } };
    expect(body.event.id).toBe("created-1");
    expect(body.event.summary).toBe("Q1 review");
    await app.close();
  });

  it("POST /api/chat 401 without session", async () => {
    const app = await buildApp(config, stores);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /api/chat succeeds with mocked calendar + ollama", async () => {
    const mockEvents: NormalizedEvent[] = [
      {
        id: "e1",
        summary: "1:1",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
        attendees: ["peer@example.com"],
      },
    ];

    const app = await buildApp(config, stores, {
      listEvents: async () => mockEvents,
      ollamaChat: async () => "You have one meeting-like event in the range.",
    });

    const sid = stores.sessions.create({
      googleRefreshToken: "fake-refresh",
      email: "u@example.com",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json",
        cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}`,
      },
      payload: JSON.stringify({
        messages: [{ role: "user", content: "How busy am I?" }],
        timeMin: "2025-01-01T00:00:00.000Z",
        timeMax: "2025-01-07T23:59:59.000Z",
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { message: { content: string } };
    expect(body.message.role).toBe("assistant");
    expect(body.message.content).toContain("one meeting");
    await app.close();
  });

  it("POST /api/chat system prompt includes signed-in email for attendee hints", async () => {
    let systemContent = "";
    const app = await buildApp(config, stores, {
      listEvents: async () => [],
      ollamaChat: async (_cfg, msgs: ChatMessage[]) => {
        systemContent = msgs.find((m) => m.role === "system")?.content ?? "";
        return "ok";
      },
    });
    const sid = stores.sessions.create({
      googleRefreshToken: "fake",
      email: "self-user@domain.test",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json",
        cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}`,
      },
      payload: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(systemContent).toContain("Session (verified server-side)");
    expect(systemContent).toContain("self-user@domain.test");
    await app.close();
  });

  it("POST /api/chat embeds clientClock in calendar JSON when client sends clock fields", async () => {
    let systemContent = "";
    const app = await buildApp(config, stores, {
      listEvents: async () => [],
      ollamaChat: async (_cfg, msgs: ChatMessage[]) => {
        systemContent = msgs.find((m) => m.role === "system")?.content ?? "";
        return "ok";
      },
    });
    const sid = stores.sessions.create({
      googleRefreshToken: "fake",
      email: "u@example.com",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json",
        cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}`,
      },
      payload: JSON.stringify({
        messages: [{ role: "user", content: "Schedule tonight" }],
        clientNowIso: "2025-01-15T03:00:00.000Z",
        ianaTimeZone: "America/New_York",
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(systemContent).toContain("Clock (from the user's browser");
    const jsonPart = systemContent.split("Calendar context JSON:\n")[1] ?? "";
    const ctx = JSON.parse(jsonPart) as {
      clientClock: { localCalendarDate: string; ianaTimeZone: string };
    };
    expect(ctx.clientClock.ianaTimeZone).toBe("America/New_York");
    expect(ctx.clientClock.localCalendarDate).toBe("2025-01-14");
    await app.close();
  });

  it("GET /api/calendar/events returns events with session + mock", async () => {
    const mockEvents: NormalizedEvent[] = [
      {
        id: "e1",
        summary: "Sync",
        start: "2025-01-02T15:00:00.000Z",
        end: "2025-01-02T16:00:00.000Z",
      },
    ];
    const app = await buildApp(config, stores, {
      listEvents: async () => mockEvents,
    });
    const sid = stores.sessions.create({
      googleRefreshToken: "fake",
      email: "u@example.com",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/calendar/events?timeMin=2025-01-01T00:00:00.000Z&timeMax=2025-01-03T00:00:00.000Z",
      headers: { cookie: `${TENEX_SESSION_COOKIE}=${app.signCookie(sid)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { events: NormalizedEvent[] };
    expect(body.events).toHaveLength(1);
    await app.close();
  });
});
