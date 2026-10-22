import "server-only";
import { requireCompany } from "@/lib/authz";
import { readParams, type ReportParams } from "./params";
import { profitAndLoss } from "./pnl";
import { aging, balanceSheet, generalLedger } from "./statements";
import { budgetVsActuals } from "@/lib/budgets";
import { query } from "@/db";
import { cashFlow, expensesByVendor, salesByCustomer, salesByProduct, trialBalance, vendor1099 } from "./more";

const money = (c: number) => (c / 100).toFixed(2);

export function toCsv(rows: (string | number | null)[][]): string {
  // Excel-safe: quote everything that needs it, neutralise formula-looking text
  return rows
    .map((r) =>
      r
        .map((v) => {
          let s = v == null ? "" : String(v);
          if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

type Builder = (companyId: string, sp: ReportParams & { view?: string; account?: string; year?: string; budget?: string }) => Promise<{ name: string; rows: (string | number | null)[][] }>;

const BUILDERS: Record<string, Builder> = {
  "budget-vs-actuals": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const ids = await query<{ id: string }>("select id from budgets where company_id = $1 order by fiscal_year desc, lower(name)", [companyId]);
    const id = ids.find((b) => b.id === sp.budget)?.id ?? ids[0]?.id;
    const r = id ? await budgetVsActuals(companyId, id, p.from, p.to, p.basis) : null;
    const rows: (string | number | null)[][] = [[p.companyName], ["Budget vs actuals", r?.budget.name ?? "", `${p.from} to ${p.to}`, p.basis], [], ["Account", "Actual", "Budget", "Over budget"]];
    for (const s of r?.sections ?? []) {
      if (!s.rows.length) continue;
      rows.push([s.title]);
      for (const row of s.rows) rows.push([`${"  ".repeat(row.depth + 1)}${row.name}`, money(row.actual), money(row.budget), money(row.actual - row.budget)]);
      rows.push([`Total ${s.title.toLowerCase()}`, money(s.actual), money(s.budget), money(s.actual - s.budget)]);
    }
    if (r) rows.push(["Net income", money(r.netIncome.actual), money(r.netIncome.budget), money(r.netIncome.actual - r.netIncome.budget)]);
    return { name: `budget-vs-actuals-${p.from}-${p.to}`, rows };
  },
  "profit-and-loss": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const r = await profitAndLoss(companyId, p.from, p.to, p.basis, p.byMonth);
    const rows: (string | number | null)[][] = [[p.companyName], ["Profit and loss", `${p.from} to ${p.to}`, p.basis], [], ["Account", ...r.columns]];
    for (const s of [r.income, r.cogs, r.expenses, r.otherIncome, r.otherExpense]) {
      if (s.rows.length === 0) continue;
      rows.push([s.title]);
      for (const row of s.rows) rows.push([`${"  ".repeat(row.depth + 1)}${row.name}`, ...row.amounts.map(money)]);
      rows.push([`Total ${s.title.toLowerCase()}`, ...s.totals.map(money)]);
    }
    rows.push(["Net income", ...r.netIncome.map(money)]);
    return { name: `profit-and-loss-${p.from}-${p.to}`, rows };
  },
  "balance-sheet": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const bs = await balanceSheet(companyId, p.asOf, p.basis, p.fyStartMonth);
    const rows: (string | number | null)[][] = [[p.companyName], ["Balance sheet", `as of ${p.asOf}`, p.basis], [], ["Account", "Amount"], ["Assets"]];
    for (const g of bs.assets) {
      rows.push([`  ${g.title}`]);
      for (const l of g.lines) rows.push([`${"  ".repeat(l.depth + 2)}${l.name}`, money(l.amount)]);
      rows.push([`  Total ${g.title.toLowerCase()}`, money(g.total)]);
    }
    rows.push(["Total assets", money(bs.totalAssets)], ["Liabilities and equity"]);
    for (const g of [...bs.liabilities, bs.equity]) {
      rows.push([`  ${g.title}`]);
      for (const l of g.lines) rows.push([`${"  ".repeat(l.depth + 2)}${l.name}`, money(l.amount)]);
      rows.push([`  Total ${g.title.toLowerCase()}`, money(g.total)]);
    }
    rows.push(["Total liabilities and equity", money(bs.totalLiabilities + bs.totalEquity)]);
    return { name: `balance-sheet-${p.asOf}`, rows };
  },
  "trial-balance": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const tb = await trialBalance(companyId, p.asOf, p.basis, p.fyStartMonth);
    return {
      name: `trial-balance-${p.asOf}`,
      rows: [[p.companyName], ["Trial balance", `as of ${p.asOf}`, p.basis], [], ["Account", "Debit", "Credit"], ...tb.rows.map((r) => [r.name, r.debit ? money(r.debit) : "", r.credit ? money(r.credit) : ""]), ["Total", money(tb.debit), money(tb.credit)]],
    };
  },
  "cash-flow": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const cf = await cashFlow(companyId, p.from, p.to, p.basis);
    const rows: (string | number | null)[][] = [[p.companyName], ["Statement of cash flows", `${p.from} to ${p.to}`, p.basis], [], ["Operating activities"], ["  Net income", money(cf.netIncome)]];
    for (const l of cf.operating) rows.push([`  ${l.name}`, money(l.amount)]);
    rows.push(["Net cash from operating activities", money(cf.netOperating)], ["Investing activities"]);
    for (const l of cf.investing) rows.push([`  ${l.name}`, money(l.amount)]);
    rows.push(["Net cash from investing activities", money(cf.netInvesting)], ["Financing activities"]);
    for (const l of cf.financing) rows.push([`  ${l.name}`, money(l.amount)]);
    rows.push(["Net cash from financing activities", money(cf.netFinancing)], ["Net change in cash", money(cf.netChange)], ["Cash at the start", money(cf.cashStart)], ["Cash at the end", money(cf.cashEnd)]);
    return { name: `cash-flow-${p.from}-${p.to}`, rows };
  },
  "sales-by-customer": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const r = await salesByCustomer(companyId, p.from, p.to, p.basis);
    return { name: `sales-by-customer-${p.from}-${p.to}`, rows: [["Customer", "Amount"], ...r.map((x) => [x.name, money(x.amount)])] };
  },
  "expenses-by-vendor": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const r = await expensesByVendor(companyId, p.from, p.to, p.basis);
    return { name: `expenses-by-vendor-${p.from}-${p.to}`, rows: [["Vendor", "Amount"], ...r.map((x) => [x.name, money(x.amount)])] };
  },
  "sales-by-product": async (companyId, sp) => {
    const p = await readParams(companyId, sp);
    const r = await salesByProduct(companyId, p.from, p.to);
    return { name: `sales-by-product-${p.from}-${p.to}`, rows: [["Product or service", "Quantity", "Amount"], ...r.map((x) => [x.name, x.qty, money(x.amount)])] };
  },
  "vendor-1099": async (companyId, sp) => {
    const year = Number(sp.year) || new Date().getFullYear();
    const r = await vendor1099(companyId, year);
    return { name: `1099-${year}`, rows: [["Vendor", "Tax ID", "Paid", "Over threshold"], ...r.rows.map((v) => [v.name, v.tax_id, money(v.paid_cents), v.paid_cents >= r.thresholdCents ? "Yes" : "No"])] };
  },
  "ar-aging": (companyId, sp) => agingCsv(companyId, sp, "ar"),
  "ap-aging": (companyId, sp) => agingCsv(companyId, sp, "ap"),
  "general-ledger": async (companyId, sp) => {
    const p = await readParams(companyId, sp, "this_month");
    const gl = await generalLedger(companyId, p.from, p.to, p.basis, sp.account ?? null);
    const rows: (string | number | null)[][] = [[p.companyName], ["General ledger", `${p.from} to ${p.to}`, p.basis], [], ["Account", "Date", "Type", "No.", "Name", "Memo", "Amount", "Balance"]];
    for (const a of gl) {
      rows.push([a.name, "", "Beginning balance", "", "", "", "", money(a.opening)]);
      for (const r of a.rows) rows.push([a.name, r.entry_date, r.type, r.number, r.contact, r.memo, money(r.amount), money(r.balance)]);
    }
    return { name: `general-ledger-${p.from}-${p.to}`, rows };
  },
};

async function agingCsv(companyId: string, sp: ReportParams & { view?: string }, side: "ar" | "ap") {
  const p = await readParams(companyId, sp);
  const r = await aging(companyId, side, p.asOf);
  const rows: (string | number | null)[][] = [[p.companyName], [`${side.toUpperCase()} aging`, `as of ${p.asOf}`], []];
  if (sp.view === "detail") {
    rows.push(["Date", "Type", "No.", "Name", "Due date", "Days past due", "Open balance"]);
    for (const d of r.detail) rows.push([d.txn_date, d.type, d.number, d.contact, d.due_date, d.days, money(d.open)]);
  } else {
    rows.push(["Name", "Current", "1-30", "31-60", "61-90", "91 and over", "Total"]);
    for (const x of [...r.rows, { name: "Total", ...r.totals }]) rows.push([x.name, money(x.current), money(x.d1_30), money(x.d31_60), money(x.d61_90), money(x.d91), money(x.total)]);
  }
  return { name: `${side}-aging-${p.asOf}`, rows };
}

export function csvRoute(report: keyof typeof BUILDERS) {
  return async function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
    const { companyId } = await params;
    await requireCompany(companyId);
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    const { name, rows } = await BUILDERS[report](companyId, sp);
    return new Response("﻿" + toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  };
}
