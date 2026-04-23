import { randomUUID } from "node:crypto";
import { google, calendar_v3 } from "googleapis";
import type { NormalizedEvent } from "./scheduleEngine.js";

function toIso(d: calendar_v3.Schema$EventDateTime | undefined): string | null {
  if (!d) return null;
  if (d.dateTime) return d.dateTime;
  if (d.date) return `${d.date}T00:00:00.000Z`;
  return null;
}

export async function listEvents(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  timeMin: string,
  timeMax: string,
): Promise<NormalizedEvent[]> {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const cal = google.calendar({ version: "v3", auth: oauth2Client });

  const events: NormalizedEvent[] = [];
  let pageToken: string | undefined;

  do {
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    for (const item of res.data.items ?? []) {
      const start = toIso(item.start);
      const end = toIso(item.end);
      if (!start || !end) continue;
      events.push({
        id: item.id?.trim() || randomUUID(),
        summary: item.summary ?? "(no title)",
        start,
        end,
        htmlLink: item.htmlLink ?? undefined,
        attendees: (item.attendees ?? [])
          .map((a) => a.email)
          .filter((e): e is string => Boolean(e)),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return events;
}

export type CreatedCalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  htmlLink?: string;
  attendees?: string[];
};

export type CreateCalendarEventInput = {
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: { email: string }[];
};

/** Inserts an event on the user's primary calendar and sends updates to attendees (`sendUpdates: all`). */
export async function createCalendarEvent(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  input: CreateCalendarEventInput,
): Promise<CreatedCalendarEvent> {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const cal = google.calendar({ version: "v3", auth: oauth2Client });

  const res = await cal.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
      attendees: input.attendees.map((a) => ({ email: a.email })),
    },
  });

  const item = res.data;
  const start = toIso(item?.start);
  const end = toIso(item?.end);
  if (!item?.id || !start || !end) {
    throw new Error("calendar_create_response_incomplete");
  }

  return {
    id: item.id,
    summary: item.summary ?? input.summary,
    description: item.description ?? input.description,
    start,
    end,
    htmlLink: item.htmlLink ?? undefined,
    attendees: (item.attendees ?? [])
      .map((a) => a.email)
      .filter((e): e is string => Boolean(e)),
  };
}
