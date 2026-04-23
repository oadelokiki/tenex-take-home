export type SessionResponse =
  | { authenticated: false }
  | { authenticated: true; email: string };

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
  attendees?: string[];
  description?: string;
};

export async function getSession(): Promise<SessionResponse> {
  const r = await fetch("/api/session", { credentials: "include" });
  if (!r.ok) throw new Error("session_failed");
  return r.json() as Promise<SessionResponse>;
}

export async function fetchCalendarEvents(
  timeMin: string,
  timeMax: string,
): Promise<{ events: CalendarEvent[] }> {
  const q = new URLSearchParams({ timeMin, timeMax });
  const r = await fetch(`/api/calendar/events?${q}`, { credentials: "include" });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "calendar_failed");
  }
  return r.json() as Promise<{ events: CalendarEvent[] }>;
}

export type CalendarEventCreateInput = {
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: string[];
};

export type ValidateCalendarEventResult =
  | { ok: true; event: CalendarEventCreateInput }
  | {
      ok: false;
      message: string;
      details?: { fieldErrors?: Record<string, string[] | undefined>; formErrors?: string[] };
    };

/** Validate create payload with the same rules as POST /api/calendar/events without writing to Google. */
export async function validateCalendarEvent(body: CalendarEventCreateInput): Promise<ValidateCalendarEventResult> {
  const r = await fetch("/api/calendar/events/validate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    event?: CalendarEventCreateInput;
    message?: string;
    details?: { fieldErrors?: Record<string, string[] | undefined> };
  };
  if (r.ok && data.ok === true && data.event) {
    return { ok: true, event: data.event };
  }
  return {
    ok: false,
    message: typeof data.message === "string" ? data.message : "Validation failed",
    details: data.details,
  };
}

export async function createCalendarEvent(body: CalendarEventCreateInput): Promise<{ event: CalendarEvent }> {
  const r = await fetch("/api/calendar/events", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as {
      message?: string;
      details?: { fieldErrors?: Record<string, string[] | undefined> };
    };
    const flat = err.details?.fieldErrors
      ? Object.entries(err.details.fieldErrors)
          .filter(([, v]) => v?.length)
          .map(([k, v]) => `${k}: ${v!.join(", ")}`)
          .join("; ")
      : "";
    const msg = [err.message, flat].filter(Boolean).join(" — ");
    throw new Error(msg || "create_event_failed");
  }
  return r.json() as Promise<{ event: CalendarEvent }>;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Browser clock + zone for each chat turn (server uses for “tonight” / relative scheduling). */
export function getClientClockPayload(): {
  clientNowIso: string;
  ianaTimeZone: string;
  localCalendarDate: string;
} {
  const now = new Date();
  const ianaTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localCalendarDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { clientNowIso: now.toISOString(), ianaTimeZone, localCalendarDate };
}

export async function postChat(body: {
  messages: ChatMessage[];
  timeMin?: string;
  timeMax?: string;
  clientNowIso?: string;
  ianaTimeZone?: string;
  localCalendarDate?: string;
}): Promise<{ message: { role: "assistant"; content: string } }> {
  const r = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "chat_failed");
  }
  return r.json() as Promise<{ message: { role: "assistant"; content: string } }>;
}

export async function logout(): Promise<void> {
  await fetch("/logout", { method: "POST", credentials: "include" });
}
