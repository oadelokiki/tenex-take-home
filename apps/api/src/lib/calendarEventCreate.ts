import { z } from "zod";
import { calendarIsoString } from "./calendarRange.js";

const attendeeEmail = z
  .string()
  .trim()
  .min(1, "Attendee email required")
  .max(320)
  .email("Invalid attendee email");

/** Single timed event on the user's primary calendar; attendees and description are required. */
export const calendarEventCreateBodySchema = z
  .object({
    summary: z.string().trim().min(1, "Title required").max(500),
    description: z.string().trim().min(1, "Description required").max(8000),
    start: calendarIsoString,
    end: calendarIsoString,
    attendees: z.array(attendeeEmail).min(1, "At least one attendee required").max(50),
  })
  .superRefine((val, ctx) => {
    const startMs = new Date(val.start).getTime();
    const endMs = new Date(val.end).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return;
    if (endMs <= startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "end must be after start",
        path: ["end"],
      });
    }
    const maxSpanMs = 14 * 24 * 60 * 60 * 1000;
    if (endMs - startMs > maxSpanMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Event cannot span more than 14 days",
        path: ["end"],
      });
    }
    const seen = new Set<string>();
    for (let i = 0; i < val.attendees.length; i++) {
      const key = val.attendees[i].toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate attendee email",
          path: ["attendees", i],
        });
      }
      seen.add(key);
    }
  });

export type CalendarEventCreateBody = z.infer<typeof calendarEventCreateBodySchema>;
