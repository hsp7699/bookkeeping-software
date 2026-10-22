import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { profitAndLoss } from "@/lib/reports/pnl";
import { deleteTransaction, saveTransaction } from "./save";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
const acct: Record<string, string> = {};
let customer = "";
let vendor = "";
const txn = (id: string) => one<{ doc_status: string | null; balance_cents: number; total_cents: number }>("select doc_status, balance_cents, total_cents from transactions where id = $1", [id]);

d("phase 2 pipeline (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`p2+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "P2 Co", entityType: "sole_prop", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    customer = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'Acme') returning id", [companyId]))!.id;
    vendor = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'vendor', 'Supply Co') returning id", [companyId]))!.id;
  });
  afterAll(() => pool.end());
  const save = (i: object) => saveTransaction(companyId, userId, i);

  it("estimate -> progress invoices -> closed; posts nothing until invoiced", async () => {
    const est = await save({ type: "estimate", contactId: customer, txnDate: "2026-04-01", lines: [{ accountId: acct["Services"], amountCents: 100000 }] });
    expect(est.number).toBe("1001");
    expect((await txn(est.id))!.doc_status).toBe("pending");
    expect((await one<{ n: number }>("select count(*)::int as n from ledger_entries where transaction_id = $1", [est.id]))!.n).toBe(0);
    const inv1 = await save({ type: "invoice", contactId: customer, txnDate: "2026-04-10", linkedFromId: est.id, lines: [{ accountId: acct["Services"], amountCents: 40000 }] });
    expect((await txn(est.id))!.doc_status).toBe("accepted");
    await save({ type: "invoice", contactId: customer, txnDate: "2026-05-10", linkedFromId: est.id, lines: [{ accountId: acct["Services"], amountCents: 60000 }] });
    expect((await txn(est.id))!.doc_status).toBe("closed");
    await deleteTransaction(companyId, userId, inv1.id);
    const { refreshDocStatus } = await import("./save");
    await tx((db) => refreshDocStatus(db, est.id));
    expect((await txn(est.id))!.doc_status).toBe("accepted");
  });

  it("purchase order -> bill closes it", async () => {
    const po = await save({ type: "purchase_order", contactId: vendor, txnDate: "2026-04-01", lines: [{ accountId: acct["Cost of Goods Sold"], amountCents: 5000 }] });
    expect((await txn(po.id))!.doc_status).toBe("open");
    await save({ type: "bill", contactId: vendor, txnDate: "2026-04-05", linkedFromId: po.id, lines: [{ accountId: acct["Cost of Goods Sold"], amountCents: 5000 }] });
    expect((await txn(po.id))!.doc_status).toBe("closed");
    await expect(save({ type: "bill", contactId: customer === vendor ? vendor : (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'vendor', 'Other') returning id", [companyId]))!.id, txnDate: "2026-04-05", linkedFromId: po.id, lines: [{ accountId: acct["Cost of Goods Sold"], amountCents: 1 }] })).rejects.toThrow(/same name/);
  });

  it("billable expense is billed once, and the link survives edits", async () => {
    const exp = await save({ type: "expense", txnDate: "2026-04-02", accountId: acct["Business Checking"], lines: [{ accountId: acct["Travel"], amountCents: 23000, billable: true, contactId: customer }] });
    const line = (await one<{ id: string }>("select id from transaction_lines where transaction_id = $1", [exp.id]))!.id;
    const inv = await save({ type: "invoice", contactId: customer, txnDate: "2026-04-20", lines: [{ accountId: acct["Services"], amountCents: 23000, billsLineId: line, description: "Travel" }] });
    await expect(save({ type: "invoice", contactId: customer, txnDate: "2026-04-21", lines: [{ accountId: acct["Services"], amountCents: 23000, billsLineId: line }] })).rejects.toThrow(/already billed/);
    // editing the expense keeps it billed
    await save({ type: "expense", id: exp.id, txnDate: "2026-04-02", accountId: acct["Business Checking"], memo: "edited", lines: [{ accountId: acct["Travel"], amountCents: 23000, billable: true, contactId: customer }] });
    const billed = await one<{ b: string | null }>("select billed_line_id as b from transaction_lines where transaction_id = $1", [exp.id]);
    expect(billed!.b).not.toBeNull();
    // deleting the invoice frees it again
    await deleteTransaction(companyId, userId, inv.id);
    const freed = await one<{ b: string | null }>("select billed_line_id as b from transaction_lines where transaction_id = $1", [exp.id]);
    expect(freed!.b).toBeNull();
  });

  it("class and location reach the ledger; tax payment clears the liability", async () => {
    const cls = (await one<{ id: string }>("insert into classes (company_id, name) values ($1, 'Design') returning id", [companyId]))!.id;
    const loc = (await one<{ id: string }>("insert into locations (company_id, name) values ($1, 'Portland') returning id", [companyId]))!.id;
    const tag = (await one<{ id: string }>("insert into tags (company_id, name) values ($1, 'Q2 push') returning id", [companyId]))!.id;
    const rate = (await one<{ id: string }>("insert into tax_rates (company_id, name, agency, rate_bp) values ($1, 'ME', 'Maine Revenue', 550) returning id", [companyId]))!.id;
    const inv = await save({ type: "invoice", contactId: customer, txnDate: "2026-06-01", locationId: loc, tagIds: [tag], taxRateId: rate, lines: [{ accountId: acct["Services"], amountCents: 10000, classId: cls, taxable: true }] });
    const e = await one<{ class_id: string; location_id: string }>("select class_id, location_id from ledger_entries where transaction_id = $1 and account_id = $2", [inv.id, acct["Services"]]);
    expect(e).toEqual({ class_id: cls, location_id: loc });
    expect((await one<{ n: number }>("select count(*)::int as n from transaction_tags where transaction_id = $1", [inv.id]))!.n).toBe(1);
    await save({ type: "sales_tax_payment", txnDate: "2026-07-15", accountId: acct["Business Checking"], amountCents: 550 });
    // paid in full later -> cash basis brings the class along
    await save({ type: "payment", contactId: customer, txnDate: "2026-06-20", accountId: acct["Business Checking"], amountCents: 10550, applications: [{ txnId: inv.id, amountCents: 10550 }] });
    for (const basis of ["accrual", "cash"] as const) {
      const r = await profitAndLoss(companyId, "2026-06-01", "2026-06-30", basis, "class");
      expect(r.columns).toEqual(["Design", "Not specified", "Total"]);
      const services = r.income.rows.find((x) => x.name === "Services")!;
      expect(services.amounts).toEqual([10000, 0, 10000]);
    }
    const stp = await one<{ v: number }>("select sum(credit_cents - debit_cents)::bigint as v from ledger_entries where account_id = $1", [acct["Sales Tax Payable"]]);
    expect(stp!.v).toBe(0);
  });
});
