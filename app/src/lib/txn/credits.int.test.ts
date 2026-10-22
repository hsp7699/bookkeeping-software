import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { ledgerSql } from "@/lib/reports/core";
import { profitAndLoss } from "@/lib/reports/pnl";
import { aging, balanceSheet } from "@/lib/reports/statements";
import { applyCredit, listCredits, unapplyCredit } from "./credits";
import { deleteTransaction, saveTransaction } from "./save";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
const acct: Record<string, string> = {};
let customer = "";
let vendor = "";
const bal = async (id: string) => (await one<{ b: number }>("select balance_cents as b from transactions where id = $1", [id]))!.b;
const arBalance = async () => (await one<{ v: number }>("select coalesce(sum(debit_cents - credit_cents), 0)::bigint as v from ledger_entries where account_id = $1", [acct["Accounts Receivable"]]))!.v;

d("applying credits (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`cr+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "Credit Co", entityType: "sole_prop", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    customer = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'Acme') returning id", [companyId]))!.id;
    vendor = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'vendor', 'Supply Co') returning id", [companyId]))!.id;
  });
  afterAll(() => pool.end());
  const save = (i: object) => saveTransaction(companyId, userId, i);

  it("credit memo and an overpayment settle an invoice without touching the ledger", async () => {
    const inv = await save({ type: "invoice", contactId: customer, txnDate: "2026-05-01", lines: [{ accountId: acct["Services"], amountCents: 30000 }] });
    const cm = await save({ type: "credit_memo", contactId: customer, txnDate: "2026-05-05", lines: [{ accountId: acct["Services"], amountCents: 10000 }] });
    const over = await save({ type: "payment", contactId: customer, txnDate: "2026-05-06", accountId: acct["Business Checking"], amountCents: 25000 }); // unapplied
    expect((await listCredits(companyId, customer, "ar")).map((c) => c.balance_cents)).toEqual([10000, 25000]);
    const arBefore = await arBalance();
    await applyCredit(companyId, userId, cm.id, inv.id, 10000);
    await applyCredit(companyId, userId, over.id, inv.id, 20000);
    expect(await bal(inv.id)).toBe(0);
    expect(await bal(cm.id)).toBe(0);
    expect(await bal(over.id)).toBe(5000);
    expect(await arBalance()).toBe(arBefore);
    await expect(applyCredit(companyId, userId, over.id, inv.id, 1)).rejects.toThrow(/is open/);

    // reports still balance on both bases, and cash income is exactly the cash received
    const s = await one<{ s: number }>(`select coalesce(sum(net), 0)::bigint as s from (${ledgerSql("cash")}) l`, [companyId]);
    expect(s!.s).toBe(0);
    for (const b of ["accrual", "cash"] as const) expect((await balanceSheet(companyId, "2026-12-31", b, 1)).outOfBalance).toBe(0);
    const cash = await profitAndLoss(companyId, "2026-01-01", "2026-12-31", "cash");
    expect(cash.income.totals[0]).toBe(20000); // 300 invoice − 100 credit, settled by 200 of real money
    const ag = await aging(companyId, "ar", "2026-12-31");
    expect(ag.totals.total).toBe(-5000); // the 50 left on the overpayment

    // unapply, and deleting the credit memo frees the invoice again
    await unapplyCredit(companyId, userId, over.id, inv.id);
    expect(await bal(inv.id)).toBe(20000);
    await deleteTransaction(companyId, userId, cm.id);
    expect(await bal(inv.id)).toBe(30000);
  });

  it("vendor credit against a bill", async () => {
    const bill = await save({ type: "bill", contactId: vendor, txnDate: "2026-06-01", lines: [{ accountId: acct["Office Supplies & Software"], amountCents: 8000 }] });
    const vc = await save({ type: "vendor_credit", contactId: vendor, txnDate: "2026-06-03", lines: [{ accountId: acct["Office Supplies & Software"], amountCents: 3000 }] });
    await applyCredit(companyId, userId, vc.id, bill.id, 3000);
    expect(await bal(bill.id)).toBe(5000);
    expect(await bal(vc.id)).toBe(0);
    const s = await one<{ s: number }>(`select coalesce(sum(net), 0)::bigint as s from (${ledgerSql("cash")}) l`, [companyId]);
    expect(s!.s).toBe(0);
    const cash = await profitAndLoss(companyId, "2026-06-01", "2026-06-30", "cash");
    expect(cash.expenses.totals[0]).toBe(0); // nothing paid in cash yet: bill share +30 and credit −30 cancel
  });
});
