/** Calendar date (YYYY-MM-DD) for an instant in a given IANA time zone. */
export function localCalendarDateInTimeZone(isoInstant: string, ianaTimeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoInstant));
}
