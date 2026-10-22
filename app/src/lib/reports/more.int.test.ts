import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { saveTransaction } from "@/lib/txn/save";
import { cashFlow, expensesByVendor, salesByCustomer, salesByProduct, salesTaxLiability, trialBalance, vendor1099 } from "./more";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
const acct: Record<string, string> = {};
let acme = "";
let landlord = "";

d("more reports (database)", () => {
  beforeAll(async () => {
    const userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`mr+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "MR Co", entityType: "sole_prop", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    acme = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'Acme') returning id", [companyId]))!.id;
    landlord = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name, track_1099) values ($1, 'vendor', 'Landlord', true) returning id", [companyId]))!.id;
    const item = (await one<{ id: string }>("insert into items (company_id, name, type, income_account_id) values ($1, 'Hours', 'service', $2) returning id", [companyId, acct["Services"]]))!.id;
    const rate = (await one<{ id: string }>("insert into tax_rates (company_id, name, agency, rate_bp) values ($1, 'ME', 'Maine Revenue', 550) returning id", [companyId]))!.id;
    const save = (i: object) => saveTransaction(companyId, userId, i);
    await save({ type: "opening_balance", txnDate: "2025-12-31", accountId: acct["Business Checking"], amountCents: 500000 });
    await save({ type: "expense", contactId: landlord, txnDate: "2025-06-01", accountId: acct["Business Checking"], lines: [{ accountId: acct["Rent & Lease"], amountCents: 100000 }] });
    const inv = await save({ type: "invoice", contactId: acme, txnDate: "2026-02-01", taxRateId: rate, lines: [{ itemId: item, qty: 10, rateCents: 10000, amountCents: 100000, taxable: true }, { itemId: item, qty: 1, rateCents: 20000, amountCents: 20000, taxable: false }] });
    await save({ type: "payment", contactId: acme, txnDate: "2026-02-20", accountId: acct["Business Checking"], amountCents: 50000, applications: [{ txnId: inv.id, amountCents: 50000 }] });
    await save({ type: "credit_memo", contactId: acme, txnDate: "2026-03-01", taxRateId: rate, lines: [{ itemId: item, qty: 1, rateCents: 10000, amountCents: 10000, taxable: true }] });
    for (const m of ["01", "02", "03"]) await save({ type: "check", contactId: landlord, txnDate: `2026-${m}-01`, accountId: acct["Business Checking"], lines: [{ accountId: acct["Rent & Lease"], amountCents: 90000 }] });
    await save({ type: "expense", contactId: landlord, txnDate: "2026-03-05", accountId: acct["Business Credit Card"], lines: [{ accountId: acct["Repairs & Maintenance"], amountCents: 12000 }] });
    await save({ type: "journal_entry", txnDate: "2026-03-10", lines: [{ accountId: acct["Equipment"], amountCents: 30000, side: "debit" }, { accountId: acct["Business Checking"], amountCents: 30000, side: "credit" }] });
    await save({ type: "sales_tax_payment", txnDate: "2026-03-31", accountId: acct["Business Checking"], amountCents: 3000 });
  });
  afterAll(() => pool.end());

  it("trial balance debits equal credits, with prior-year profit in retained earnings", async () => {
    for (const basis of ["accrual", "cash"] as const) {
      const tb = await trialBalance(companyId, "2026-03-31", basis, 1);
      expect(tb.debit).toBe(tb.credit);
      const re = tb.rows.find((r) => r.name === "Retained Earnings")!;
      expect(re.debit).toBe(100000); // the 2025 rent: a loss
    }
  });

  it("cash flow ties to the change in the bank", async () => {
    for (const basis of ["accrual", "cash"] as const) {
      const cf = await cashFlow(companyId, "2026-01-01", "2026-03-31", basis);
      expect(cf.netChange).toBe(cf.cashEnd - cf.cashStart);
      expect(cf.netInvesting).toBe(-30000);
    }
  });

  it("sales by customer and product, expenses by vendor", async () => {
    const sc = await salesByCustomer(companyId, "2026-01-01", "2026-03-31", "accrual");
    expect(sc).toEqual([{ contact_id: acme, name: "Acme", amount: 110000 }]);
    const sp = await salesByProduct(companyId, "2026-01-01", "2026-03-31");
    expect(sp[0]).toMatchObject({ name: "Hours", qty: 10, amount: 110000 });
    const ev = await expensesByVendor(companyId, "2026-01-01", "2026-03-31", "accrual");
    expect(ev.find((r) => r.name === "Landlord")!.amount).toBe(282000);
  });

  it("sales tax liability", async () => {
    const st = await salesTaxLiability(companyId, "2026-01-01", "2026-03-31");
    expect(st.byRate[0].taxable_cents).toBe(100000 - 10000);
    expect(st.taxCollected).toBe(5500 - 550);
    expect(st.paid).toBe(3000);
    expect(st.owedEnd).toBe(4950 - 3000);
  });

  it("1099 counts bank payments only, against the year's threshold", async () => {
    const r = await vendor1099(companyId, 2026);
    expect(r.rows[0].paid_cents).toBe(270000); // three checks; the card expense is left out
    expect(r.thresholdCents).toBe(200000);
  });
});
