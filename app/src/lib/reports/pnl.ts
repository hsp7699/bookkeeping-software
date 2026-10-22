import "server-only";
import { accountTotals, accountTotalsByMonth, monthsBetween, type Basis } from "./core";
import type { AccountType } from "@/lib/coa";

export interface ReportRow {
  accountId: string;
  name: string;
  depth: number;
  /** one amount per column (a single "Total" column, or one per month plus a total) */
  amounts: number[];
}

export interface ReportSection {
  key: string;
  title: string;
  rows: ReportRow[];
  totals: number[];
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  basis: Basis;
  columns: string[]; // "Total" or months "2026-01" ... plus "Total"
  income: ReportSection;
  cogs: ReportSection;
  grossProfit: number[];
  expenses: ReportSection;
  netOperatingIncome: number[];
  otherIncome: ReportSection;
  otherExpense: ReportSection;
  netOtherIncome: number[];
  netIncome: number[];
}

const SECTIONS: { key: "income" | "cogs" | "expenses" | "otherIncome" | "otherExpense"; type: AccountType; title: string }[] = [
  { key: "income", type: "income", title: "Income" },
  { key: "cogs", type: "cost_of_goods_sold", title: "Cost of goods sold" },
  { key: "expenses", type: "expense", title: "Expenses" },
  { key: "otherIncome", type: "other_income", title: "Other income" },
  { key: "otherExpense", type: "other_expense", title: "Other expenses" },
];

/** Accounts in tree order: each sub-account right after its parent. */
export function treeOrder<T extends { id: string; parent_id: string | null }>(rows: T[], all: Map<string, string | null>): (T & { depth: number })[] {
  const depthOf = (id: string): number => {
    let d = 0;
    let p = all.get(id);
    while (p) {
      d++;
      p = all.get(p) ?? null;
    }
    return d;
  };
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const key = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: (T & { depth: number })[] = [];
  const walk = (parent: string | null) => {
    for (const r of byParent.get(parent) ?? []) {
      out.push({ ...r, depth: depthOf(r.id) });
      walk(r.id);
    }
  };
  walk(null);
  return out;
}

const sumCols = (rows: { amounts: number[] }[], n: number) => Array.from({ length: n }, (_, i) => rows.reduce((s, r) => s + r.amounts[i], 0));
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);

export async function profitAndLoss(companyId: string, from: string, to: string, basis: Basis, byMonth = false, parents?: Map<string, string | null>): Promise<ProfitAndLoss> {
  const types = SECTIONS.map((s) => s.type);
  let columns: string[];
  let perAccount: Map<string, { id: string; name: string; type: AccountType; parent_id: string | null; amounts: number[] }>;
  if (byMonth) {
    const months = monthsBetween(from, to);
    columns = [...months, "Total"];
    perAccount = new Map();
    for (const r of await accountTotalsByMonth(companyId, basis, from, to, types)) {
      const e = perAccount.get(r.id) ?? { id: r.id, name: r.name, type: r.type, parent_id: r.parent_id, amounts: Array(columns.length).fill(0) };
      e.amounts[months.indexOf(r.month)] += r.amount;
      e.amounts[columns.length - 1] += r.amount;
      perAccount.set(r.id, e);
    }
  } else {
    columns = ["Total"];
    perAccount = new Map((await accountTotals(companyId, basis, from, to, types)).map((r) => [r.id, { id: r.id, name: r.name, type: r.type, parent_id: r.parent_id, amounts: [r.amount] }]));
  }
  const n = columns.length;
  const all = parents ?? new Map([...perAccount.values()].map((a) => [a.id, a.parent_id]));
  const sections = Object.fromEntries(
    SECTIONS.map((s) => {
      const accounts = [...perAccount.values()].filter((a) => a.type === s.type && a.amounts.some((v) => v !== 0));
      const rows = treeOrder(accounts, all).map((a) => ({ accountId: a.id, name: a.name, depth: a.depth, amounts: a.amounts }));
      return [s.key, { key: s.key, title: s.title, rows, totals: sumCols(rows, n) }];
    }),
  ) as Record<(typeof SECTIONS)[number]["key"], ReportSection>;
  const gross = sub(sections.income.totals, sections.cogs.totals);
  const operating = sub(gross, sections.expenses.totals);
  const other = sub(sections.otherIncome.totals, sections.otherExpense.totals);
  return {
    from,
    to,
    basis,
    columns,
    ...sections,
    grossProfit: gross,
    netOperatingIncome: operating,
    netOtherIncome: other,
    netIncome: add(operating, other),
  };
}
