import { describe, expect, it } from "vitest";
import { allocate, applyRate, formatCents, lineAmount, parseMoney } from "./money";

describe("parseMoney", () => {
  it.each([
    ["1234.5", 123450],
    ["1,234.50", 123450],
    ["$1,234.50", 123450],
    ["-12", -1200],
    ["(12.00)", -1200],
    [".5", 50],
    ["0.005", 1],
    ["0.004", 0],
    ["=12*3+1.5", 3750],
    ["=(10+5)/4", 375],
  ])("%s -> %d", (input, cents) => expect(parseMoney(input)).toBe(cents));

  it.each(["", "abc", "1.2.3", "=1+", "=alert(1)", "."])("rejects %j", (input) =>
    expect(parseMoney(input)).toBeNull(),
  );
});

describe("formatCents", () => {
  it("formats", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-500)).toBe("-$5.00");
    expect(formatCents(0)).toBe("$0.00");
  });
});

describe("line math", () => {
  it("rounds per line half-up", () => {
    expect(lineAmount(3, 33.335)).toBe(100);
    expect(lineAmount(1.5, 1999)).toBe(2999);
  });
  it("applies basis points", () => {
    expect(applyRate(10000, 825)).toBe(825);
    expect(applyRate(1999, 825)).toBe(165);
  });
});

describe("allocate", () => {
  it("always sums to the total", () => {
    for (const total of [1, 100, 9999, -10001, 123457]) {
      for (const w of [[1, 1, 1], [50, 30, 20], [1, 2], [7]]) {
        const parts = allocate(total, w);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
  it("splits evenly with the remainder to the first", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});
