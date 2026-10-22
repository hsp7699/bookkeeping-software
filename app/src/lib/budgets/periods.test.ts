import { describe, expect, it } from "vitest";
import { fiscalMonths, fiscalYearOf, periodMonth, spreadEvenly } from "./periods";

describe("budget periods", () => {
  it("calendar fiscal year", () => {
    expect(fiscalMonths(2026, 1)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  });
  it("July fiscal year crosses the calendar year", () => {
    expect(periodMonth(2026, 7, 1)).toBe("2026-07");
    expect(periodMonth(2026, 7, 6)).toBe("2026-12");
    expect(periodMonth(2026, 7, 7)).toBe("2027-01");
    expect(periodMonth(2026, 7, 12)).toBe("2027-06");
  });
  it("finds the fiscal year of a date", () => {
    expect(fiscalYearOf("2027-03-15", 7)).toBe(2026);
    expect(fiscalYearOf("2026-07-01", 7)).toBe(2026);
    expect(fiscalYearOf("2026-10-22", 1)).toBe(2026);
  });
  it("spreads to the cent", () => {
    const s = spreadEvenly(100000);
    expect(s.reduce((a, b) => a + b, 0)).toBe(100000);
    expect(s[0]).toBe(8334);
    expect(s[11]).toBe(8333);
    expect(spreadEvenly(-1200).every((v) => v === -100)).toBe(true);
  });
});
