// Integration tests: the save pipeline against a real Postgres (DATABASE_URL).
// Each run creates a fresh company, so runs don't interfere.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { deleteTransaction, saveTransaction, UserError, voidTransaction, type TxnInput } from "./save";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

let companyId = "";
let userId = "";
const acct: Record<string, string> = {};
let customer = "";
let vendor = "";
let item = "";

async function balance(name: string) {
  const r = await one<{ b: number }>(
    "select coalesce(sum(e.debit_cents - e.credit_cents), 0)::bigint as b from ledger_entries e where e.account_id = $1",
    [acct[name]],
  );
  return r!.b;
}
const save = (input: TxnInput, opts = {}) => saveTransaction(companyId, userId, input, opts);
const txn = (id: string) => one<{ balance_cents: number; total_cents: number; status: string; number: string | null }>("select balance_cents, total_cents, status, number from transactions where id = $1", [id]);

d("save pipeline (database)", () => {
  beforeAll(async () => {
    const u = await one<{ id: string }>("insert into users (email, name) values ($1, 'Test') returning id", [`int+${Date.now()}@example.com`]);
    userId = u!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "Int Co", entityType: "llc_single", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    customer = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'Acme') returning id", [companyId]))!.id;
    vendor = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'vendor', 'Landlord LLC') returning id", [companyId]))!.id;
    item = (await one<{ id: string }>(
      "insert into items (company_id, name, type, sales_price_cents, income_account_id) values ($1, 'Consulting', 'service', 10000, $2) returning id",
      [companyId, acct["Services"]],
    ))!.id;
  });
  afterAll(async () => {
    await pool.end();
  });

  it("invoice -> partial payment -> balances and A/R", async () => {
    const inv = await save({ type: "invoice", contactId: customer, txnDate: "2026-03-01", dueDate: "2026-03-31", lines: [{ itemId: item, qty: 3, rateCents: 10000, amountCents: 30000 }] });
    expect(inv.number).toBe("1001");
    expect(await balance("Accounts Receivable")).toBe(30000);
    const pay = await save({ type: "payment", contactId: customer, txnDate: "2026-03-10", amountCents: 12000, applications: [{ txnId: inv.id, amountCents: 12000 }] });
    expect((await txn(inv.id))!.balance_cents).toBe(18000);
    expect(await balance("Undeposited Funds")).toBe(12000);
    expect(await balance("Accounts Receivable")).toBe(18000);
    // overpay an invoice: refused
    await expect(save({ type: "payment", contactId: customer, txnDate: "2026-03-11", amountCents: 50000, applications: [{ txnId: inv.id, amountCents: 50000 }] })).rejects.toThrow(/only has 180.00 open/);
    // editing the invoice below what's paid: refused
    await expect(save({ type: "invoice", id: inv.id, contactId: customer, txnDate: "2026-03-01", lines: [{ itemId: item, qty: 1, rateCents: 10000, amountCents: 10000 }] })).rejects.toThrow(/already applied/);
    // deleting a paid invoice: refused
    await expect(deleteTransaction(companyId, userId, inv.id)).rejects.toThrow(/Payments are applied/);
    // delete the payment -> invoice fully open again
    await deleteTransaction(companyId, userId, pay.id);
    expect((await txn(inv.id))!.balance_cents).toBe(30000);
  });

  it("deposit groups Undeposited Funds payments into the bank", async () => {
    const inv = await save({ type: "invoice", contactId: customer, txnDate: "2026-04-01", lines: [{ itemId: item, qty: 1, rateCents: 10000, amountCents: 10000 }] });
    const p1 = await save({ type: "payment", contactId: customer, txnDate: "2026-04-02", amountCents: 10000, applications: [{ txnId: inv.id, amountCents: 10000 }] });
    const sr = await save({ type: "sales_receipt", contactId: customer, txnDate: "2026-04-02", lines: [{ itemId: item, qty: 1, rateCents: 2500, amountCents: 2500 }] });
    const ufBefore = await balance("Undeposited Funds");
    const bankBefore = await balance("Business Checking");
    const dep = await save({
      type: "deposit",
      txnDate: "2026-04-03",
      accountId: acct["Business Checking"],
      depositSourceIds: [p1.id, sr.id],
      lines: [{ accountId: acct["Bank Fees & Service Charges"], amountCents: -300 }],
    });
    expect(await balance("Undeposited Funds")).toBe(ufBefore - 12500);
    expect(await balance("Business Checking")).toBe(bankBefore + 12200);
    // a deposited payment can't be deposited twice or voided
    await expect(save({ type: "deposit", txnDate: "2026-04-04", accountId: acct["Business Checking"], depositSourceIds: [p1.id] })).rejects.toThrow(/already in another deposit/);
    await expect(voidTransaction(companyId, userId, p1.id)).rejects.toThrow(/bank deposit/);
    await deleteTransaction(companyId, userId, dep.id);
    expect(await balance("Undeposited Funds")).toBe(ufBefore);
  });

  it("bill -> bill payment, vendor credit, expense, credit card credit", async () => {
    const bill = await save({ type: "bill", contactId: vendor, txnDate: "2026-05-01", dueDate: "2026-05-31", number: "INV-77", lines: [{ accountId: acct["Rent & Lease"], amountCents: 200000 }] });
    expect(await balance("Accounts Payable")).toBe(-200000);
    await save({ type: "bill_payment", contactId: vendor, txnDate: "2026-05-15", accountId: acct["Business Checking"], amountCents: 200000, applications: [{ txnId: bill.id, amountCents: 200000 }] });
    expect((await txn(bill.id))!.balance_cents).toBe(0);
    expect(await balance("Accounts Payable")).toBe(0);
    await save({ type: "expense", contactId: vendor, txnDate: "2026-05-02", accountId: acct["Business Credit Card"], lines: [{ accountId: acct["Meals"], amountCents: 4500 }, { accountId: acct["Travel"], amountCents: 12000 }] });
    expect(await balance("Business Credit Card")).toBe(-16500);
    await save({ type: "credit_card_credit", txnDate: "2026-05-03", accountId: acct["Business Credit Card"], lines: [{ accountId: acct["Travel"], amountCents: 2000 }] });
    expect(await balance("Business Credit Card")).toBe(-14500);
    // a check can't come from a credit card
    await expect(save({ type: "check", txnDate: "2026-05-03", accountId: acct["Business Credit Card"], lines: [{ accountId: acct["Meals"], amountCents: 1 }] })).rejects.toThrow(/bank account/);
  });

  it("transfer, journal entry, opening balance", async () => {
    const before = await balance("Business Checking");
    await save({ type: "opening_balance", txnDate: "2026-01-01", accountId: acct["Business Checking"], amountCents: 500000 });
    expect(await balance("Business Checking")).toBe(before + 500000);
    await save({ type: "transfer", txnDate: "2026-06-01", accountId: acct["Business Credit Card"], fromAccountId: acct["Business Checking"], amountCents: 14500 });
    expect(await balance("Business Credit Card")).toBe(0);
    const je = await save({
      type: "journal_entry",
      txnDate: "2026-06-30",
      lines: [
        { accountId: acct["Depreciation"], amountCents: 5000, side: "debit" },
        { accountId: acct["Accumulated Depreciation"], amountCents: 5000, side: "credit" },
      ],
    });
    expect(je.number).toBe("1");
    await expect(
      save({ type: "journal_entry", txnDate: "2026-06-30", lines: [{ accountId: acct["Depreciation"], amountCents: 5000, side: "debit" }, { accountId: acct["Accumulated Depreciation"], amountCents: 4000, side: "credit" }] }),
    ).rejects.toThrow(/off by 10/);
    // A/R on a JE needs a name
    await expect(
      save({ type: "journal_entry", txnDate: "2026-06-30", lines: [{ accountId: acct["Accounts Receivable"], amountCents: 100, side: "debit" }, { accountId: acct["Services"], amountCents: 100, side: "credit" }] }),
    ).rejects.toThrow(/choose a customer or vendor/);
  });

  it("void keeps the number and posts nothing", async () => {
    const inv = await save({ type: "invoice", contactId: customer, txnDate: "2026-07-01", lines: [{ itemId: item, qty: 1, rateCents: 10000, amountCents: 10000 }] });
    const arBefore = await balance("Accounts Receivable");
    await voidTransaction(companyId, userId, inv.id);
    const t = await txn(inv.id);
    expect(t!.status).toBe("voided");
    expect(t!.number).not.toBeNull();
    expect(await balance("Accounts Receivable")).toBe(arBefore - 10000);
    await expect(save({ type: "invoice", id: inv.id, contactId: customer, txnDate: "2026-07-01", lines: [{ itemId: item, qty: 1, rateCents: 1, amountCents: 1 }] })).rejects.toThrow(/voided/);
  });

  it("closed period blocks writes unless overridden", async () => {
    await query("update companies set close_date = '2026-01-31' where id = $1", [companyId]);
    await expect(save({ type: "expense", txnDate: "2026-01-15", accountId: acct["Business Checking"], lines: [{ accountId: acct["Meals"], amountCents: 100 }] })).rejects.toThrow(UserError);
    const ok = await save({ type: "expense", txnDate: "2026-01-15", accountId: acct["Business Checking"], lines: [{ accountId: acct["Meals"], amountCents: 100 }] }, { closeOverride: true });
    expect(ok.id).toBeTruthy();
    await query("update companies set close_date = null where id = $1", [companyId]);
  });

  it("optimistic concurrency", async () => {
    const inv = await save({ type: "invoice", contactId: customer, txnDate: "2026-08-01", lines: [{ itemId: item, qty: 1, rateCents: 10000, amountCents: 10000 }] });
    const v = (await one<{ u: string }>("select updated_at::text as u from transactions where id = $1", [inv.id]))!.u;
    await save({ type: "invoice", id: inv.id, ifUpdatedAt: v, contactId: customer, txnDate: "2026-08-01", lines: [{ itemId: item, qty: 2, rateCents: 10000, amountCents: 20000 }] });
    await expect(
      save({ type: "invoice", id: inv.id, ifUpdatedAt: v, contactId: customer, txnDate: "2026-08-01", lines: [{ itemId: item, qty: 3, rateCents: 10000, amountCents: 30000 }] }),
    ).rejects.toThrow(/Someone else changed/);
  });

  it("the whole ledger balances and every write was audited", async () => {
    const r = await one<{ d: number; c: number }>("select sum(debit_cents)::bigint as d, sum(credit_cents)::bigint as c from ledger_entries where company_id = $1", [companyId]);
    expect(r!.d).toBe(r!.c);
    const a = await one<{ n: number }>("select count(*)::int as n from audit_events where company_id = $1 and entity = 'transaction'", [companyId]);
    expect(a!.n).toBeGreaterThan(15);
  });
});
