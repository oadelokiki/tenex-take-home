import { z } from "zod";

/** Cap length so query strings / JSON cannot carry arbitrarily large “ISO-like” blobs into parsing. */
export const calendarIsoString = z.string().max(80).datetime({ offset: true });

export const calendarQuerySchema = z
  .object({
    timeMin: calendarIsoString,
    timeMax: calendarIsoString,
  })
  .superRefine((val, ctx) => {
    const min = new Date(val.timeMin);
    const max = new Date(val.timeMax);
    if (max <= min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeMax must be after timeMin",
        path: ["timeMax"],
      });
    }
  });

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export function assertRangeWithinMaxDays(
  query: CalendarQuery,
  maxDays: number,
): void {
  const min = new Date(query.timeMin).getTime();
  const max = new Date(query.timeMax).getTime();
  const spanDays = (max - min) / (1000 * 60 * 60 * 24);
  if (spanDays > maxDays) {
    throw new RangeError(
      `Calendar range exceeds maximum of ${maxDays} days (requested ${spanDays.toFixed(1)})`,
    );
  }
}
