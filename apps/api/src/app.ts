import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { CodeChallengeMethod } from "google-auth-library";
import { google } from "googleapis";
import { z } from "zod";
import type { AppConfig } from "./lib/config.js";
import { calendarEventCreateBodySchema } from "./lib/calendarEventCreate.js";
import { localCalendarDateInTimeZone } from "./lib/clientClock.js";
import {
  assertRangeWithinMaxDays,
  calendarIsoString,
  calendarQuerySchema,
} from "./lib/calendarRange.js";
import { pkceChallengeS256 } from "./lib/pkce.js";
import type { AppStores } from "./lib/appStores.js";
import { sessionCookieOpts } from "./lib/sessionCookie.js";
import { TENEX_SESSION_COOKIE } from "./lib/sessionConstants.js";
import { createCalendarEvent, listEvents } from "./services/calendarService.js";
import {
  buildAssistantContextJson,
  computeFreeBlocksInWorkday,
  computeMeetingStats,
} from "./services/scheduleEngine.js";
import {
  ollamaChat as defaultOllamaChat,
  SYSTEM_PROMPT,
  type ChatMessage,
} from "./services/ollama.js";
import { registerE2eRoutes } from "./e2e/register.js";

const ianaTimeZoneString = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_+\/-]+$/, "invalid IANA time zone characters");

const localCalendarDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Client may send user + assistant transcript only; server prepends the sole `system` message. */
const chatBodySchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(20_000),
        }),
      )
      .min(1)
      .max(50),
    timeMin: calendarIsoString.optional(),
    timeMax: calendarIsoString.optional(),
    /** Browser clock when the user sent this request (anchor for "tonight" / "today"). */
    clientNowIso: calendarIsoString.optional(),
    /** IANA time zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
    ianaTimeZone: ianaTimeZoneString.optional(),
    /** Optional; server can derive from clientNowIso + ianaTimeZone when omitted. */
    localCalendarDate: localCalendarDateString.optional(),
  })
  .superRefine((data, ctx) => {
    const hasClock = Boolean(data.clientNowIso || data.ianaTimeZone || data.localCalendarDate);
    if (!hasClock) return;
    if (!data.clientNowIso) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clientNowIso is required when sending client clock fields",
        path: ["clientNowIso"],
      });
    }
    if (!data.ianaTimeZone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ianaTimeZone is required when sending client clock fields",
        path: ["ianaTimeZone"],
      });
    }
  });

export type AppDeps = {
  listEvents: typeof listEvents;
  createCalendarEvent: typeof createCalendarEvent;
  ollamaChat: typeof defaultOllamaChat;
};

const defaultDeps: AppDeps = {
  listEvents,
  createCalendarEvent,
  ollamaChat: defaultOllamaChat,
};

/** Absolute URL on the SPA origin (e.g. `/?auth=success`). `pathWithQuery` must start with `/` or `?`. */
function publicWebUrl(config: AppConfig, pathWithQuery: string): string {
  const base = config.PUBLIC_WEB_ORIGIN.replace(/\/+$/, "");
  const path = pathWithQuery.startsWith("/") || pathWithQuery.startsWith("?") ? pathWithQuery : `/${pathWithQuery}`;
  return `${base}${path}`;
}

export async function buildApp(
  config: AppConfig,
  stores: AppStores,
  deps: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  const {
    listEvents: fetchEvents,
    createCalendarEvent: insertCalendarEvent,
    ollamaChat: runOllama,
  } = { ...defaultDeps, ...deps };
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    bodyLimit: 512 * 1024,
    trustProxy: true,
  });

  await app.register(cookie, {
    secret: config.SESSION_SECRET,
    hook: "onRequest",
  });

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });

  app.get("/health", async () => ({ ok: true }));

  /** Resolve session id from signed cookie */
  function getSessionId(req: FastifyRequest): string | undefined {
    const raw = req.cookies[TENEX_SESSION_COOKIE];
    if (!raw) return undefined;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid) return undefined;
    return unsigned.value;
  }

  app.get("/api/session", async (req, reply) => {
    const sid = getSessionId(req);
    if (!sid) return { authenticated: false as const };
    const s = stores.sessions.get(sid);
    if (!s) {
      reply.clearCookie(TENEX_SESSION_COOKIE, sessionCookieOpts(config));
      return { authenticated: false as const };
    }
    return { authenticated: true as const, email: s.email };
  });

  app.post("/logout", async (req, reply) => {
    const sid = getSessionId(req);
    if (sid) stores.sessions.destroy(sid);
    reply.clearCookie(TENEX_SESSION_COOKIE, sessionCookieOpts(config));
    return { ok: true };
  });

  app.get(
    "/auth/google",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (_req, reply) => {
      const { state, codeVerifier } = stores.oauthPending.create();
      const challenge = pkceChallengeS256(codeVerifier);

      const oauth2Client = new google.auth.OAuth2(
        config.GOOGLE_CLIENT_ID,
        config.GOOGLE_CLIENT_SECRET,
        config.GOOGLE_REDIRECT_URI,
      );

      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
          /** Read/write events (create/update/delete); narrower than full `calendar` scope. */
          "https://www.googleapis.com/auth/calendar.events",
          "openid",
          "https://www.googleapis.com/auth/userinfo.email",
        ],
        state,
        code_challenge: challenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });

      return reply.redirect(url);
    },
  );

  app.get("/auth/google/callback", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const code = q.code;
    const state = q.state;
    const err = q.error;
    if (err) {
      return reply.redirect(publicWebUrl(config, `/?auth=error&message=${encodeURIComponent(err)}`));
    }
    if (!code || !state) {
      return reply.redirect(publicWebUrl(config, "/?auth=error&message=missing_code"));
    }

    const pending = stores.oauthPending.consume(state);
    if (!pending) return reply.redirect(publicWebUrl(config, "/?auth=error&message=invalid_state"));

    const oauth2Client = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI,
    );

    let refreshToken: string;
    try {
      const { tokens } = await oauth2Client.getToken({
        code,
        codeVerifier: pending.codeVerifier,
        redirect_uri: config.GOOGLE_REDIRECT_URI,
      });
      if (!tokens.refresh_token) {
        return reply.redirect(
          publicWebUrl(config, "/?auth=error&message=no_refresh_token_reconnect"),
        );
      }
      refreshToken = tokens.refresh_token;
      oauth2Client.setCredentials(tokens);
    } catch {
      return reply.redirect(publicWebUrl(config, "/?auth=error&message=token_exchange_failed"));
    }

    let email = "unknown@user";
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const info = await oauth2.userinfo.get();
      if (info.data.email) email = info.data.email;
    } catch {
      /* keep default */
    }

    const oldSid = getSessionId(req);
    if (oldSid) stores.sessions.destroy(oldSid);

    const newSid = stores.sessions.create({
      googleRefreshToken: refreshToken,
      email,
    });

    reply.setCookie(TENEX_SESSION_COOKIE, newSid, sessionCookieOpts(config));

    return reply.redirect(publicWebUrl(config, "/?auth=success"));
  });

  app.get("/api/calendar/events", async (req, reply) => {
    const sid = getSessionId(req);
    if (!sid) return reply.status(401).send({ error: "unauthorized", message: "Sign in required" });
    const session = stores.sessions.get(sid);
    if (!session) return reply.status(401).send({ error: "unauthorized", message: "Session expired" });

    const parsed = calendarQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    try {
      assertRangeWithinMaxDays(parsed.data, config.CALENDAR_MAX_RANGE_DAYS);
    } catch (e) {
      return reply.status(400).send({
        error: "range_error",
        message: e instanceof Error ? e.message : "invalid range",
      });
    }

    try {
      const events = await fetchEvents(
        session.googleRefreshToken,
        config.GOOGLE_CLIENT_ID,
        config.GOOGLE_CLIENT_SECRET,
        config.GOOGLE_REDIRECT_URI,
        parsed.data.timeMin,
        parsed.data.timeMax,
      );
      return { events };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "calendar_error";
      req.log.warn({ err: msg }, "calendar fetch failed");
      return reply.status(502).send({ error: "calendar_upstream", message: "Could not load calendar" });
    }
  });

  app.post(
    "/api/calendar/events",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const sid = getSessionId(req);
      if (!sid) return reply.status(401).send({ error: "unauthorized", message: "Sign in required" });
      const session = stores.sessions.get(sid);
      if (!session) return reply.status(401).send({ error: "unauthorized", message: "Session expired" });

      const parsed = calendarEventCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Invalid event body",
          details: parsed.error.flatten(),
        });
      }

      const body = parsed.data;
      try {
        const event = await insertCalendarEvent(
          session.googleRefreshToken,
          config.GOOGLE_CLIENT_ID,
          config.GOOGLE_CLIENT_SECRET,
          config.GOOGLE_REDIRECT_URI,
          {
            summary: body.summary,
            description: body.description,
            start: body.start,
            end: body.end,
            attendees: body.attendees.map((email) => ({ email })),
          },
        );
        return reply.status(201).send({ event });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "calendar_create_error";
        req.log.warn({ err: msg }, "calendar create failed");
        return reply.status(502).send({ error: "calendar_upstream", message: "Could not create calendar event" });
      }
    },
  );

  app.post(
    "/api/calendar/events/validate",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const sid = getSessionId(req);
      if (!sid) return reply.status(401).send({ error: "unauthorized", message: "Sign in required" });
      const session = stores.sessions.get(sid);
      if (!session) return reply.status(401).send({ error: "unauthorized", message: "Session expired" });

      const parsed = calendarEventCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: "validation_error",
          message: "Invalid event body",
          details: parsed.error.flatten(),
        });
      }

      return { ok: true, event: parsed.data };
    },
  );

  app.post(
    "/api/chat",
    {
      config: {
        rateLimit: { max: 40, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const sid = getSessionId(req);
      if (!sid) return reply.status(401).send({ error: "unauthorized", message: "Sign in required" });
      const session = stores.sessions.get(sid);
      if (!session) return reply.status(401).send({ error: "unauthorized", message: "Session expired" });

      const bodyParsed = chatBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: "validation_error", details: bodyParsed.error.flatten() });
      }

      const now = new Date();
      const defaultMin = bodyParsed.data.timeMin ?? new Date(now.getTime()).toISOString();
      const defaultMax =
        bodyParsed.data.timeMax ??
        new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

      const rangeParsed = calendarQuerySchema.safeParse({ timeMin: defaultMin, timeMax: defaultMax });
      if (!rangeParsed.success) {
        return reply.status(400).send({ error: "validation_error", details: rangeParsed.error.flatten() });
      }
      try {
        assertRangeWithinMaxDays(rangeParsed.data, config.CALENDAR_MAX_RANGE_DAYS);
      } catch (e) {
        return reply.status(400).send({
          error: "range_error",
          message: e instanceof Error ? e.message : "invalid range",
        });
      }

      let events;
      try {
        events = await fetchEvents(
          session.googleRefreshToken,
          config.GOOGLE_CLIENT_ID,
          config.GOOGLE_CLIENT_SECRET,
          config.GOOGLE_REDIRECT_URI,
          rangeParsed.data.timeMin,
          rangeParsed.data.timeMax,
        );
      } catch {
        return reply.status(502).send({ error: "calendar_upstream", message: "Could not load calendar" });
      }

      const stats = computeMeetingStats(events);
      const freeByDay = computeFreeBlocksInWorkday(
        events,
        new Date(rangeParsed.data.timeMin),
        new Date(rangeParsed.data.timeMax),
      );
      const d = bodyParsed.data;
      const clientClock =
        d.clientNowIso && d.ianaTimeZone
          ? {
              clientNowIso: d.clientNowIso,
              ianaTimeZone: d.ianaTimeZone,
              localCalendarDate:
                d.localCalendarDate ?? localCalendarDateInTimeZone(d.clientNowIso, d.ianaTimeZone),
            }
          : undefined;

      const contextJson = buildAssistantContextJson({
        timeMin: rangeParsed.data.timeMin,
        timeMax: rangeParsed.data.timeMax,
        events,
        stats,
        freeByDay,
        clientClock,
      });

      const userMessages: ChatMessage[] = bodyParsed.data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const clockHint = clientClock
        ? `\n\nClock (from the user's browser for this request): **${clientClock.clientNowIso}** in **${clientClock.ianaTimeZone}** → local calendar date **${clientClock.localCalendarDate}**. ` +
          `For phrases like **tonight**, **today**, or **this evening**, use that **local calendar date** and zone to pick start/end in the \`tenex-event\` JSON — do not infer "today" only from the calendar week \`range\` (that range is the visible week, which may differ from the user's wall-clock day).`
        : "";

      const sessionHint =
        `\n\nSession (verified server-side): The signed-in user's Google account email is **${session.email}**. ` +
        `When they say they are the only attendee, "myself", "just me", "only me", or similar, include **this exact email** in the \`tenex-event\` JSON \`attendees\` array. ` +
        `Never use placeholder addresses (e.g. your_email@example.com).`;

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}${sessionHint}${clockHint}\n\nCalendar context JSON:\n${contextJson}`,
        },
        ...userMessages,
      ];

      try {
        const assistant = await runOllama(config, messages);
        return { message: { role: "assistant" as const, content: assistant } };
      } catch (e) {
        req.log.warn({ err: e instanceof Error ? e.message : e }, "ollama failed");
        return reply.status(502).send({ error: "llm_upstream", message: "Assistant temporarily unavailable" });
      }
    },
  );

  if (config.E2E_MODE) {
    registerE2eRoutes(app, { config, stores });
  }

  return app;
}

export type { AppStores } from "./lib/appStores.js";
