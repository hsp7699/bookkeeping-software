import { addDays } from "@/lib/dates";
import type { StatementKind } from "@/lib/statements";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Statement options from the query string, with defaults: balance forward, the last 30 days. */
export function statementParams(sp: Record<string, string | string[] | undefined>, today: string) {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const kind: StatementKind = get("kind") === "open_item" ? "open_item" : "balance_forward";
  const to = DATE.test(get("to")) ? get("to") : today;
  let from = DATE.test(get("from")) ? get("from") : addDays(to, -30);
  if (from > to) from = to;
  return { kind, from, to };
}
