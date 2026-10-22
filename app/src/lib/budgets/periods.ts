// Budget periods: month 1..12 of a fiscal year. Pure, no database.

/** "YYYY-MM" for period `p` of the fiscal year that starts in `fyStartMonth` of `fiscalYear`. */
export function periodMonth(fiscalYear: number, fyStartMonth: number, p: number): string {
  const m0 = fyStartMonth - 1 + (p - 1);
  return `${fiscalYear + Math.floor(m0 / 12)}-${String((m0 % 12) + 1).padStart(2, "0")}`;
}

export function fiscalMonths(fiscalYear: number, fyStartMonth: number): string[] {
  return Array.from({ length: 12 }, (_, i) => periodMonth(fiscalYear, fyStartMonth, i + 1));
}

/** The fiscal year (the calendar year it starts in) that contains `date`. */
export function fiscalYearOf(date: string, fyStartMonth: number): number {
  const [y, m] = date.split("-").map(Number);
  return m >= fyStartMonth ? y : y - 1;
}

/** Split a yearly amount into 12 whole-cent months; the remainder goes to the earliest months. */
export function spreadEvenly(totalCents: number): number[] {
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / 12);
  const extra = abs - base * 12;
  return Array.from({ length: 12 }, (_, i) => sign * (base + (i < extra ? 1 : 0)));
}
