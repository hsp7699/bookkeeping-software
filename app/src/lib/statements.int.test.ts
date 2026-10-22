import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { saveTransaction } from "@/lib/txn/save";
import { loadStatement } from "./statements";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
let customer = "";
const acct: Record<string, string> = {};

d("customer statements (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`stmt+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "Stmt Co", entityType: "sole_prop", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    customer = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'Statement Client') returning id", [companyId]))!.id;
  });
  afterAll(() => pool.end());
  const save = (i: object) => saveTransaction(companyId, userId, i);

  it("balance forward and open item agree on the amount due", async () => {
    const inv1 = await save({ type: "invoice", contactId: customer, txnDate: "2026-05-01", dueDate: "2026-05-31", lines: [{ accountId: acct["Services"], amountCents: 100000 }] });
    await save({ type: "invoice", contactId: customer, txnDate: "2026-06-10", dueDate: "2026-07-10", lines: [{ accountId: acct["Services"], amountCents: 50000 }] });
    await save({
      type: "payment",
      contactId: customer,
      txnDate: "2026-06-15",
      accountId: acct["Undeposited Funds"],
      amountCents: 40000,
      applications: [{ txnId: inv1.id, amountCents: 40000 }],
    });

    const fwd = await loadStatement(companyId, customer, "balance_forward", "2026-06-01", "2026-06-30");
    expect(fwd!.openingCents).toBe(100000);
    expect(fwd!.rows.map((r) => [r.date, r.amountCents, r.balanceCents])).toEqual([
      ["2026-06-10", 50000, 150000],
      ["2026-06-15", -40000, 110000],
    ]);
    expect(fwd!.closingCents).toBe(110000);

    const open = await loadStatement(companyId, customer, "open_item", "2026-06-01", "2026-06-30");
    expect(open!.rows.map((r) => r.amountCents).sort()).toEqual([50000, 60000]);
    expect(open!.closingCents).toBe(110000);
    // as of June 30 the May invoice is 30 days late; the June one isn't due yet
    expect(open!.aging.d1_30).toBe(60000);
    expect(open!.aging.current).toBe(50000);
  });
});
