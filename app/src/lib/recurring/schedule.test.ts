import { describe, expect, it } from "vitest";
import { describeSchedule, firstOccurrence, nextOccurrence } from "./schedule";

describe("nextOccurrence", () => {
  it("weeks", () => {
    expect(nextOccurrence("2026-12-28", { unit: "week", count: 1 })).toBe("2027-01-04");
    expect(nextOccurrence("2026-01-01", { unit: "week", count: 2 })).toBe("2026-01-15");
  });
  it("months keep the day, and month-ends stay month-ends", () => {
    expect(nextOccurrence("2026-01-15", { unit: "month", count: 1 })).toBe("2026-02-15");
    expect(nextOccurrence("2026-01-31", { unit: "month", count: 1, dayOfMonth: 31 })).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", { unit: "month", count: 1, dayOfMonth: 31 })).toBe("2026-03-31");
    expect(nextOccurrence("2028-01-31", { unit: "month", count: 1, dayOfMonth: 31 })).toBe("2028-02-29");
    expect(nextOccurrence("2026-11-30", { unit: "month", count: 3, dayOfMonth: 30 })).toBe("2027-02-28");
  });
  it("years", () => {
    expect(nextOccurrence("2028-02-29", { unit: "year", count: 1, dayOfMonth: 29 })).toBe("2029-02-28");
    expect(nextOccurrence("2026-06-01", { unit: "year", count: 2 })).toBe("2028-06-01");
  });
});

describe("firstOccurrence", () => {
  it("aligns to the day of month", () => {
    expect(firstOccurrence("2026-10-22", { unit: "month", count: 1, dayOfMonth: 25 })).toBe("2026-10-25");
    expect(firstOccurrence("2026-10-22", { unit: "month", count: 1, dayOfMonth: 1 })).toBe("2026-11-01");
    expect(firstOccurrence("2026-10-22", { unit: "week", count: 1 })).toBe("2026-10-22");
  });
});

describe("describeSchedule", () => {
  it("reads naturally", () => {
    expect(describeSchedule({ unit: "month", count: 1, dayOfMonth: 1 })).toBe("Every month, on day 1");
    expect(describeSchedule({ unit: "week", count: 2 })).toBe("Every 2 weeks");
    expect(describeSchedule({ unit: "month", count: 3, dayOfMonth: 31 })).toBe("Every 3 months, on the last day");
  });
});
