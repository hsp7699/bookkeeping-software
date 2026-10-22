import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { deleteTransaction, saveTransaction, UserError } from "@/lib/txn/save";
import { finish, lastReconciled, startReconciliation, tick, undoLast, workspace } from "./reconcile";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
const acct: Record<string, string> = {};

d("reconciliation (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`rec+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "Rec Co", entityType: "sole_prop", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
  });
  afterAll(() => pool.end());

  const save = (i: object) => saveTransaction(companyId, userId, i);

  it("ticks to zero, locks, refuses edits, and undoes", async () => {
    const bank = acct["Business Checking"];
    await save({ type: "opening_balance", txnDate: "2026-01-01", accountId: bank, amountCents: 100000 });
    const fee = await save({ type: "expense", txnDate: "2026-01-10", accountId: bank, lines: [{ accountId: acct["Bank Fees & Service Charges"], amountCents: 1500 }] });
    await save({ type: "transfer", txnDate: "2026-02-05", accountId: acct["Business Credit Card"], fromAccountId: bank, amountCents: 20000 }); // after the statement date

    const id = await tx((db) => startReconciliation(db, companyId, bank, "2026-01-31", 98500));
    let w = await workspace(companyId, id);
    expect(w!.entries.map((e) => e.amount_cents).sort()).toEqual([-1500, 100000]); // the Feb transfer isn't on a Jan statement
    expect(w!.differenceCents).toBe(98500);
    await tx((db) => tick(db, companyId, id, w!.entries.map((e) => e.id), true));
    w = await workspace(companyId, id);
    expect(w!.differenceCents).toBe(0);
    await tx((db) => finish(db, companyId, userId, id, false));

    // reconciled entries are locked
    await expect(save({ type: "expense", id: fee.id, txnDate: "2026-01-10", accountId: bank, lines: [{ accountId: acct["Bank Fees & Service Charges"], amountCents: 1600 }] })).rejects.toThrow(UserError);
    await expect(deleteTransaction(companyId, userId, fee.id)).rejects.toThrow(/reconciled/);

    // the next statement starts from 985.00
    const info = await lastReconciled(null, companyId, bank);
    expect(info.beginningCents).toBe(98500);
    expect(info.reconciledNowCents).toBe(98500);

    // undo puts them back to cleared, and edits work again
    await tx((db) => undoLast(db, companyId, userId, id));
    await save({ type: "expense", id: fee.id, txnDate: "2026-01-10", accountId: bank, lines: [{ accountId: acct["Bank Fees & Service Charges"], amountCents: 1600 }] });
  });

  it("books an adjustment for a leftover difference only when asked", async () => {
    const card = acct["Business Credit Card"];
    await save({ type: "expense", txnDate: "2026-03-03", accountId: card, lines: [{ accountId: acct["Meals"], amountCents: 4000 }] });
    // statement says 40.25 owed; the transfer above paid 200 → card natural balance = -200 + 40 = −160 owed (a credit)
    const id = await tx((db) => startReconciliation(db, companyId, card, "2026-03-31", -15975));
    const w = await workspace(companyId, id);
    await tx((db) => tick(db, companyId, id, w!.entries.map((e) => e.id), true));
    const w2 = await workspace(companyId, id);
    expect(w2!.differenceCents).toBe(25);
    await expect(tx((db) => finish(db, companyId, userId, id, false))).rejects.toThrow(/difference is 0.25/);
    const r = await tx((db) => finish(db, companyId, userId, id, true));
    expect(r.adjustmentCents).toBe(25);
    const bal = await one<{ v: number }>("select -sum(debit_cents - credit_cents)::bigint as v from ledger_entries where account_id = $1", [card]);
    expect(bal!.v).toBe(-15975);
  });
});
