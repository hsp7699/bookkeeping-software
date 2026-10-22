import "server-only";
import type { PoolClient } from "pg";
import { one, query } from "@/db";
import type { AccountType } from "@/lib/coa";
import { accountTotals, PNL_TYPES, type Basis } from "@/lib/reports/core";
import { treeOrder } from "@/lib/reports/pnl";
import { fiscalMonths, periodMonth } from "./periods";

export interface BudgetAccount {
  id: string;
  name: string;
  type: AccountType;
  depth: number;
  /** 12 amounts, natural sign (income positive, expenses positive) */
  periods: number[];
}

export interface Budget {
  id: string;
  name: string;
  fiscalYear: number;
  fyStartMonth: number;
  months: string[];
  accounts: BudgetAccount[];
}

/** A budget with every active P&L account as a row (zeros where nothing is set). */
export async function loadBudget(companyId: string, budgetId: string): Promise<Budget | null> {
  const b = await one<{ id: string; name: string; fiscal_year: number; fy: number }>(
    "select b.id, b.name, b.fiscal_year, c.fiscal_year_start_month as fy from budgets b join companies c on c.id = b.company_id where b.company_id = $1 and b.id = $2",
    [companyId, budgetId],
  );
  if (!b) return null;
  const accts = await query<{ id: string; name: string; number: string | null; type: AccountType; parent_id: string | null }>(
    `select id, name, number, type, parent_id from accounts where company_id = $1 and type = any($2::text[])
       and (active or exists (select 1 from budget_lines l where l.budget_id = $3 and l.account_id = accounts.id))
     order by array_position($2::text[], type), number nulls last, lower(name)`,
    [companyId, PNL_TYPES, budgetId],
  );
  const lines = await query<{ account_id: string; period: number; amount_cents: string }>("select account_id, period, amount_cents from budget_lines where budget_id = $1", [budgetId]);
  const byAcct = new Map<string, number[]>();
  for (const l of lines) {
    const arr = byAcct.get(l.account_id) ?? Array(12).fill(0);
    arr[l.period - 1] = Number(l.amount_cents);
    byAcct.set(l.account_id, arr);
  }
  const parents = new Map(accts.map((a) => [a.id, a.parent_id]));
  const ordered: BudgetAccount[] = [];
  for (const t of PNL_TYPES) {
    for (const a of treeOrder(accts.filter((x) => x.type === t), parents)) ordered.push({ id: a.id, name: a.name, type: a.type, depth: a.depth, periods: byAcct.get(a.id) ?? Array(12).fill(0) });
  }
  return { id: b.id, name: b.name, fiscalYear: b.fiscal_year, fyStartMonth: b.fy, months: fiscalMonths(b.fiscal_year, b.fy), accounts: ordered };
}

/** Replace a budget's amounts. Zero cells are not stored. */
export async function saveBudgetLines(db: PoolClient, budgetId: string, rows: { accountId: string; periods: number[] }[]) {
  await query("delete from budget_lines where budget_id = $1", [budgetId], db);
  const acc: string[] = [];
  const per: number[] = [];
  const amt: number[] = [];
  for (const r of rows)
    r.periods.forEach((v, i) => {
      if (v) {
        acc.push(r.accountId);
        per.push(i + 1);
        amt.push(v);
      }
    });
  if (acc.length)
    await query(
      "insert into budget_lines (budget_id, account_id, period, amount_cents) select $1, a, p, v from unnest($2::uuid[], $3::smallint[], $4::bigint[]) as x(a, p, v)",
      [budgetId, acc, per, amt],
      db,
    );
  await query("update budgets set updated_at = now() where id = $1", [budgetId], db);
}

/** Last fiscal year's actuals, month by month, to start a budget from. */
export async function actualsForFiscalYear(companyId: string, fiscalYear: number, fyStartMonth: number, basis: Basis) {
  const months = fiscalMonths(fiscalYear, fyStartMonth);
  const out = new Map<string, number[]>();
  for (let i = 0; i < 12; i++) {
    const from = `${months[i]}-01`;
    const [y, m] = months[i].split("-").map(Number);
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    for (const a of await accountTotals(companyId, basis, from, to, PNL_TYPES)) {
      const arr = out.get(a.id) ?? Array(12).fill(0);
      arr[i] = a.amount;
      out.set(a.id, arr);
    }
  }
  return out;
}

export interface BvaRow {
  id: string;
  name: string;
  depth: number;
  actual: number;
  budget: number;
}
export interface BvaSection {
  key: string;
  title: string;
  rows: BvaRow[];
  actual: number;
  budget: number;
}

const SECTION_TITLES: Record<string, string> = { income: "Income", cost_of_goods_sold: "Cost of goods sold", expense: "Expenses", other_income: "Other income", other_expense: "Other expenses" };

/**
 * Budget vs actuals for whole months from..to. Budget amounts count for every
 * fiscal month that falls inside the range.
 */
export async function budgetVsActuals(companyId: string, budgetId: string, from: string, to: string, basis: Basis) {
  const b = await loadBudget(companyId, budgetId);
  if (!b) return null;
  const inRange = (p: number) => {
    const m = periodMonth(b.fiscalYear, b.fyStartMonth, p);
    return m >= from.slice(0, 7) && m <= to.slice(0, 7);
  };
  const actual = new Map((await accountTotals(companyId, basis, from, to, PNL_TYPES)).map((a) => [a.id, a.amount]));
  const sections: BvaSection[] = PNL_TYPES.map((t) => {
    const rows = b.accounts
      .filter((a) => a.type === t)
      .map((a) => ({ id: a.id, name: a.name, depth: a.depth, actual: actual.get(a.id) ?? 0, budget: a.periods.reduce((s, v, i) => s + (inRange(i + 1) ? v : 0), 0) }))
      .filter((r) => r.actual !== 0 || r.budget !== 0);
    return { key: t, title: SECTION_TITLES[t], rows, actual: rows.reduce((s, r) => s + r.actual, 0), budget: rows.reduce((s, r) => s + r.budget, 0) };
  });
  const get = (k: string) => sections.find((s) => s.key === k)!;
  const net = (f: (s: BvaSection) => number) => f(get("income")) - f(get("cost_of_goods_sold")) - f(get("expense")) + f(get("other_income")) - f(get("other_expense"));
  return {
    budget: b,
    sections,
    netIncome: { actual: net((s) => s.actual), budget: net((s) => s.budget) },
  };
}
