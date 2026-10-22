import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { saveTransaction } from "@/lib/txn/save";
import { actualsForFiscalYear, budgetVsActuals, loadBudget, saveBudgetLines } from "./index";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
const acct: Record<string, string> = {};

d("budgets (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`budget+${Date.now()}@example.com`]))!.id;
    // fiscal year starts in July
    companyId = await tx((db) => createCompany(db, userId, { name: "Budget Co", entityType: "sole_prop", fiscalYearStartMonth: 7, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
  });
  afterAll(() => pool.end());

  it("compares whole fiscal months with actuals and nets income", async () => {
    const save = (i: object) => saveTransaction(companyId, userId, i);
    const cust = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'B') returning id", [companyId]))!.id;
    await save({ type: "invoice", contactId: cust, txnDate: "2026-07-10", lines: [{ accountId: acct["Services"], amountCents: 300000 }] });
    await save({ type: "expense", txnDate: "2026-08-05", accountId: acct["Business Checking"], lines: [{ accountId: acct["Rent & Lease"], amountCents: 150000 }] });
    await save({ type: "expense", txnDate: "2027-01-05", accountId: acct["Business Checking"], lines: [{ accountId: acct["Rent & Lease"], amountCents: 150000 }] }); // outside the range below

    const id = (await one<{ id: string }>("insert into budgets (company_id, name, fiscal_year) values ($1, 'FY26', 2026) returning id", [companyId]))!.id;
    await tx((db) =>
      saveBudgetLines(db, id, [
        { accountId: acct["Services"], periods: Array(12).fill(250000) },
        { accountId: acct["Rent & Lease"], periods: Array(12).fill(100000) },
      ]),
    );
    const b = await loadBudget(companyId, id);
    expect(b!.months[0]).toBe("2026-07");
    expect(b!.months[11]).toBe("2027-06");

    // July and August only
    const r = await budgetVsActuals(companyId, id, "2026-07-01", "2026-08-31", "accrual");
    const row = (name: string) => r!.sections.flatMap((s) => s.rows).find((x) => x.name === name)!;
    expect(row("Services")).toMatchObject({ actual: 300000, budget: 500000 });
    expect(row("Rent & Lease")).toMatchObject({ actual: 150000, budget: 200000 });
    expect(r!.netIncome).toEqual({ actual: 150000, budget: 300000 });
  });

  it("starts a budget from last year's actuals", async () => {
    const a = await actualsForFiscalYear(companyId, 2026, 7, "accrual");
    expect(a.get(acct["Services"])![0]).toBe(300000); // July = period 1
    expect(a.get(acct["Rent & Lease"])![1]).toBe(150000); // August
    expect(a.get(acct["Rent & Lease"])![6]).toBe(150000); // January
  });
});
