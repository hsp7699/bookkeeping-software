// Reports against a real database: both bases balance, cash recognises income
// when paid, retained earnings rolls over at the fiscal year, aging buckets.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { saveTransaction } from "@/lib/txn/save";
import { ledgerSql } from "./core";
import { profitAndLoss } from "./pnl";
import { aging, balanceSheet, generalLedger } from "./statements";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
const acct: Record<string, string> = {};
let customer = "";
let vendor = "";

d("reports (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`rep+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "Rep Co", entityType: "llc_single", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    customer = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'Acme') returning id", [companyId]))!.id;
    vendor = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'vendor', 'Supplier') returning id", [companyId]))!.id;
    const tax = (await one<{ id: string }>("insert into tax_rates (company_id, name, agency, rate_bp) values ($1, 'State', 'DOR', 1000) returning id", [companyId]))!.id;
    const save = (i: object) => saveTransaction(companyId, userId, i);

    // 2025: an expense paid in cash (becomes retained earnings in 2026)
    await save({ type: "opening_balance", txnDate: "2025-01-01", accountId: acct["Business Checking"], amountCents: 1000000 });
    await save({ type: "expense", txnDate: "2025-06-01", accountId: acct["Business Checking"], lines: [{ accountId: acct["Rent & Lease"], amountCents: 50000 }] });
    // 2026: invoice 1,000 + 10% tax with a 3-cent-awkward partial payment, a bill half paid
    const inv = await save({
      type: "invoice",
      contactId: customer,
      txnDate: "2026-01-10",
      dueDate: "2026-02-09",
      taxRateId: tax,
      lines: [{ accountId: acct["Services"], amountCents: 100000, taxable: true }],
    });
    await save({ type: "payment", contactId: customer, txnDate: "2026-02-01", accountId: acct["Business Checking"], amountCents: 33333, applications: [{ txnId: inv.id, amountCents: 33333 }] });
    const bill = await save({ type: "bill", contactId: vendor, txnDate: "2026-01-15", dueDate: "2026-01-20", lines: [{ accountId: acct["Office Supplies & Software"], amountCents: 20000 }] });
    await save({ type: "bill_payment", contactId: vendor, txnDate: "2026-03-01", accountId: acct["Business Checking"], amountCents: 10000, applications: [{ txnId: bill.id, amountCents: 10000 }] });
    // an unapplied customer prepayment
    await save({ type: "payment", contactId: customer, txnDate: "2026-03-05", accountId: acct["Business Checking"], amountCents: 5000 });
  });
  afterAll(() => pool.end());

  it("the cash ledger balances to the cent", async () => {
    const r = await one<{ s: number }>(`select coalesce(sum(net), 0)::bigint as s from (${ledgerSql("cash")}) l`, [companyId]);
    expect(r!.s).toBe(0);
  });

  it("P&L: accrual vs cash", async () => {
    const acc = await profitAndLoss(companyId, "2026-01-01", "2026-12-31", "accrual");
    expect(acc.income.totals[0]).toBe(100000);
    expect(acc.expenses.totals[0]).toBe(20000);
    expect(acc.netIncome[0]).toBe(80000);
    const cash = await profitAndLoss(companyId, "2026-01-01", "2026-12-31", "cash");
    // 333.33 of 1,100.00 paid -> income 1000 × 33333/110000 = 303.03; bill half paid -> 100.00
    expect(cash.income.totals[0]).toBe(30303);
    expect(cash.expenses.totals[0]).toBe(10000);
    const months = await profitAndLoss(companyId, "2026-01-01", "2026-03-31", "cash", true);
    expect(months.columns).toEqual(["2026-01", "2026-02", "2026-03", "Total"]);
    expect(months.netIncome).toEqual([0, 30303, -10000, 20303]);
  });

  it("balance sheet balances on both bases and rolls 2025 into retained earnings", async () => {
    for (const basis of ["accrual", "cash"] as const) {
      const bs = await balanceSheet(companyId, "2026-12-31", basis, 1);
      expect(bs.outOfBalance).toBe(0);
      const re = bs.equity.lines.find((l) => l.name === "Retained Earnings")!;
      expect(re.amount).toBe(-50000);
    }
    const acc = await balanceSheet(companyId, "2026-12-31", "accrual", 1);
    const ar = acc.assets.flatMap((g) => g.lines).find((l) => l.name === "Accounts Receivable")!;
    expect(ar.amount).toBe(110000 - 33333 - 5000); // open invoice less the unapplied prepayment
    const cash = await balanceSheet(companyId, "2026-12-31", "cash", 1);
    const arCash = cash.assets.flatMap((g) => g.lines).find((l) => l.name === "Accounts Receivable");
    expect(arCash?.amount ?? 0).toBe(-5000); // only the customer credit remains
  });

  it("aging: as-of dates and buckets", async () => {
    const before = await aging(companyId, "ar", "2026-01-31");
    expect(before.totals.total).toBe(110000); // payment on Feb 1 not counted yet
    expect(before.totals.current).toBe(110000);
    const later = await aging(companyId, "ar", "2026-04-15");
    // invoice due 2/9: 65 days late -> 61-90, minus the unapplied 50.00 in current
    expect(later.totals.d61_90).toBe(110000 - 33333);
    expect(later.totals.current).toBe(-5000);
    const ap = await aging(companyId, "ap", "2026-04-15");
    expect(ap.totals.d61_90).toBe(10000); // due 1/20, 85 days
  });

  it("general ledger running balances", async () => {
    const gl = await generalLedger(companyId, "2026-01-01", "2026-12-31", "accrual", acct["Business Checking"]);
    expect(gl[0].opening).toBe(1000000 - 50000);
    expect(gl[0].closing).toBe(1000000 - 50000 + 33333 - 10000 + 5000);
  });
});
