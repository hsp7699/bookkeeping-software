// Money is always integer cents (number is safe up to ±$90 trillion).
// Never do arithmetic on dollars as floats.

export type Cents = number;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 123456 -> "$1,234.56", -500 -> "-$5.00" */
export function formatCents(cents: Cents): string {
  return usd.format(cents / 100);
}

/** 123456 -> "1,234.56" (for inputs) */
export function formatCentsPlain(cents: Cents): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Parse what a user types into a money field. Accepts "1234.5", "1,234.50",
 * "$1,234.50", "-12", "(12.00)" and simple arithmetic like "=12*3+1.5".
 * Returns null when it is not a number.
 */
export function parseMoney(input: string): Cents | null {
  let s = input.trim();
  if (s === "") return null;
  if (s.startsWith("=")) return evalArithmetic(s.slice(1));
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [whole, frac = ""] = s.split(".");
  // round half-up on the third decimal
  const padded = (frac + "000").slice(0, 3);
  let cents = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

function evalArithmetic(expr: string): Cents | null {
  // Only digits, decimal points, + - * / ( ) and spaces. Evaluated in dollars
  // with a tiny recursive-descent parser, then rounded to cents.
  const src = expr.replace(/[$,\s]/g, "");
  if (!/^[\d.+\-*/()]+$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  const num = (): number => {
    if (peek() === "(") {
      i++;
      const v = add();
      if (src[i++] !== ")") throw new Error("paren");
      return v;
    }
    if (peek() === "-") {
      i++;
      return -num();
    }
    const m = /^\d*\.?\d+|^\d+\.?/.exec(src.slice(i));
    if (!m) throw new Error("num");
    i += m[0].length;
    return Number(m[0]);
  };
  const mul = (): number => {
    let v = num();
    while (peek() === "*" || peek() === "/") {
      const op = src[i++];
      const r = num();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = add();
    if (i !== src.length || !Number.isFinite(v)) return null;
    return Math.round(v * 100);
  } catch {
    return null;
  }
}

/** Round half away from zero to whole cents. */
export function roundCents(x: number): Cents {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** qty × rate (rate in cents, may be fractional) -> cents, half-up per line. */
export function lineAmount(qty: number, rateCents: number): Cents {
  return roundCents(qty * rateCents);
}

/** amount × basis points / 10000, half-up. 825 bp = 8.25%. */
export function applyRate(amount: Cents, basisPoints: number): Cents {
  return roundCents((amount * basisPoints) / 10000);
}

/**
 * Split a total into parts by weights so the parts always sum to the total.
 * The remainder cents go to the largest fractional parts.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("allocate: weights must sum to more than 0");
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sum);
  const parts = raw.map(Math.floor);
  let rest = abs - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, idx] of order) {
    if (rest <= 0) break;
    parts[idx] += 1;
    rest -= 1;
  }
  return parts.map((p) => p * sign);
}
