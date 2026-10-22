import "server-only";
import { requireCompany } from "@/lib/authz";
import { readParams, type ReportParams } from "./params";
import { profitAndLoss } from "./pnl";
import { aging, balanceSheet, generalLedger } from "./statements";

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

type Builder = (companyId: string, sp: ReportParams & { view?: string; account?: string }) => Promise<{ name: string; rows: (string | number | null)[][] }>;

const BUILDERS: Record<string, Builder> = {
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
