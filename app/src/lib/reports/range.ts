import { addDays, fiscalYearStart, monthEnd, monthStart } from "@/lib/dates";

export const PRESETS = [
  ["this_month", "This month"],
  ["this_quarter", "This quarter"],
  ["this_fy", "This fiscal year"],
  ["fy_to_date", "Fiscal year to date"],
  ["last_month", "Last month"],
  ["last_quarter", "Last quarter"],
  ["last_fy", "Last fiscal year"],
  ["custom", "Custom"],
] as const;

export type Preset = (typeof PRESETS)[number][0];

function quarterStart(date: string, fyStartMonth: number) {
  const fy = fiscalYearStart(date, fyStartMonth);
  const [fyY, fyM] = fy.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  const monthsIn = (y - fyY) * 12 + (m - fyM);
  const q = Math.floor(monthsIn / 3);
  const start = new Date(Date.UTC(fyY, fyM - 1 + q * 3, 1));
  return start.toISOString().slice(0, 10);
}

function plusMonths(date: string, n: number) {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** Resolve a preset to [from, to] using the company's today and fiscal year. */
export function resolveRange(preset: Preset, today: string, fyStartMonth: number): [string, string] {
  switch (preset) {
    case "this_month":
      return [monthStart(today), monthEnd(today)];
    case "this_quarter": {
      const s = quarterStart(today, fyStartMonth);
      return [s, addDays(plusMonths(s, 3), -1)];
    }
    case "this_fy": {
      const s = fiscalYearStart(today, fyStartMonth);
      return [s, addDays(plusMonths(s, 12), -1)];
    }
    case "fy_to_date":
      return [fiscalYearStart(today, fyStartMonth), today];
    case "last_month": {
      const s = plusMonths(monthStart(today), -1);
      return [s, monthEnd(s)];
    }
    case "last_quarter": {
      const s = plusMonths(quarterStart(today, fyStartMonth), -3);
      return [s, addDays(plusMonths(s, 3), -1)];
    }
    case "last_fy": {
      const s = plusMonths(fiscalYearStart(today, fyStartMonth), -12);
      return [s, addDays(plusMonths(s, 12), -1)];
    }
    default:
      return [fiscalYearStart(today, fyStartMonth), today];
  }
}
