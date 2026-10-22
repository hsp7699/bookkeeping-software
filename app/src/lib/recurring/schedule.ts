// Recurring schedules: pure date math, no database.

export type IntervalUnit = "week" | "month" | "year";

/** Transaction types that can repeat. */
export const RECURRING_TYPES = ["invoice", "expense", "check", "bill", "journal_entry", "sales_receipt", "transfer"] as const;

export interface Schedule {
  unit: IntervalUnit;
  count: number; // every N units
  /** months and years: the day of the month to land on; 31 means "last day" */
  dayOfMonth?: number | null;
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(y: number, m0: number) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** The date after `date` on this schedule. Month-ends stay month-ends (Jan 31 -> Feb 28 -> Mar 31). */
export function nextOccurrence(date: string, s: Schedule): string {
  const [y, m, d] = date.split("-").map(Number);
  if (s.unit === "week") {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * s.count));
    return iso(t);
  }
  const months = s.unit === "year" ? 12 * s.count : s.count;
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm0 = ((total % 12) + 12) % 12;
  const want = s.dayOfMonth ?? d;
  const day = Math.min(want, daysInMonth(ny, nm0));
  return iso(new Date(Date.UTC(ny, nm0, day)));
}

/** The first occurrence on or after `start` (aligns a monthly schedule to its day of month). */
export function firstOccurrence(start: string, s: Schedule): string {
  if (s.unit === "week" || !s.dayOfMonth) return start;
  const [y, m, d] = start.split("-").map(Number);
  const day = Math.min(s.dayOfMonth, daysInMonth(y, m - 1));
  if (day >= d) return iso(new Date(Date.UTC(y, m - 1, day)));
  return nextOccurrence(iso(new Date(Date.UTC(y, m - 1, day))), { ...s, count: s.unit === "year" ? 12 * s.count : s.count, unit: "month" });
}

export function describeSchedule(s: Schedule): string {
  const every = s.count === 1 ? `Every ${s.unit}` : `Every ${s.count} ${s.unit}s`;
  if (s.unit === "week" || !s.dayOfMonth) return every;
  const day = s.dayOfMonth >= 31 ? "the last day" : `day ${s.dayOfMonth}`;
  return `${every}, on ${day}`;
}
