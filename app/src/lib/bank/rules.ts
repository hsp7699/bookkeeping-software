// Bank rules: conditions on a feed row, evaluated in priority order. Pure.

export type RuleField = "description" | "bank_text" | "amount";
export type RuleOp = "contains" | "not_contains" | "equals" | "gt" | "lt";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string;
}

export interface RuleSplit {
  accountId: string;
  /** one of: percent in basis points, or a fixed amount */
  percentBp?: number;
  amountCents?: number;
}

export interface RuleActions {
  txnType: "expense" | "deposit" | "transfer";
  contactId?: string | null;
  memo?: string | null;
  splits: RuleSplit[];
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  direction: "in" | "out" | "both";
  feedAccountIds: string[] | null;
  matchMode: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleActions;
  autoConfirm: boolean;
}

export interface FeedRowLike {
  feedAccountId: string;
  description: string;
  bankText: string | null;
  amountCents: number;
}

function test(c: RuleCondition, row: FeedRowLike): boolean {
  if (c.field === "amount") {
    // amounts compare on size: "amount equals 15.00" matches a $15 charge or deposit
    const v = Math.round(Number(c.value.replace(/[$,]/g, "")) * 100);
    if (!Number.isFinite(v)) return false;
    const a = Math.abs(row.amountCents);
    if (c.op === "equals") return a === v;
    if (c.op === "gt") return a > v;
    if (c.op === "lt") return a < v;
    return false;
  }
  const hay = (c.field === "description" ? row.description : row.bankText ?? row.description).toLowerCase();
  const needle = c.value.trim().toLowerCase();
  if (!needle) return false;
  if (c.op === "contains") return hay.includes(needle);
  if (c.op === "not_contains") return !hay.includes(needle);
  if (c.op === "equals") return hay.trim() === needle;
  return false;
}

export function ruleMatches(rule: Rule, row: FeedRowLike): boolean {
  if (rule.direction === "in" && row.amountCents < 0) return false;
  if (rule.direction === "out" && row.amountCents > 0) return false;
  if (rule.feedAccountIds?.length && !rule.feedAccountIds.includes(row.feedAccountId)) return false;
  if (rule.conditions.length === 0) return false;
  return rule.matchMode === "all" ? rule.conditions.every((c) => test(c, row)) : rule.conditions.some((c) => test(c, row));
}

/** The first matching rule by priority (lower first), or null. */
export function firstMatchingRule(rules: Rule[], row: FeedRowLike): Rule | null {
  return [...rules].sort((a, b) => a.priority - b.priority).find((r) => ruleMatches(r, row)) ?? null;
}

/**
 * Turn a rule's splits into line amounts that sum exactly to the row amount.
 * Fixed amounts first, then percentages share the rest; the last line takes any rounding remainder.
 */
export function splitAmounts(splits: RuleSplit[], totalCents: number): { accountId: string; amountCents: number }[] {
  const total = Math.abs(totalCents);
  if (splits.length === 0) return [];
  const fixed = splits.filter((s) => s.amountCents != null);
  const pct = splits.filter((s) => s.amountCents == null);
  const fixedSum = fixed.reduce((a, s) => a + (s.amountCents ?? 0), 0);
  const rest = Math.max(total - fixedSum, 0);
  const out = splits.map((s) => ({
    accountId: s.accountId,
    amountCents: s.amountCents != null ? s.amountCents : Math.round((rest * (s.percentBp ?? (pct.length === 1 ? 10000 : 0))) / 10000),
  }));
  const diff = total - out.reduce((a, l) => a + l.amountCents, 0);
  out[out.length - 1].amountCents += diff;
  return out;
}
