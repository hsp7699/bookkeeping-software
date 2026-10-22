import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { getFeedAccount, importRows, matchTransferPair, suggestionsFor, undoReview } from "./feed";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
const acct: Record<string, string> = {};
let bankFeed = "";
let cardFeed = "";

d("bank feed transfers (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`feed+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "Feed Co", entityType: "sole_prop", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    const link = async (accountId: string) => (await one<{ id: string }>("insert into bank_feed_accounts (company_id, account_id) values ($1, $2) returning id", [companyId, accountId]))!.id;
    bankFeed = await link(acct["Business Checking"]);
    cardFeed = await link(acct["Business Credit Card"]);
    const file = { name: "x.csv", format: "csv", columnMap: null };
    await tx((db) => importRows(db, companyId, userId, bankFeed, file, [{ date: "2026-09-01", description: "CARD PAYMENT", bankText: null, amountCents: -50000, externalId: "b1" }], null));
    await tx((db) => importRows(db, companyId, userId, cardFeed, file, [{ date: "2026-09-03", description: "PAYMENT THANK YOU", bankText: null, amountCents: 50000, externalId: "c1" }], null));
  });
  afterAll(() => pool.end());

  const rowOf = (feedId: string) => one<{ id: string; status: string; posted_date: string; amount_cents: number; matched_txn_id: string | null; created_txn_id: string | null }>(
    "select id, status, posted_date::text, amount_cents, matched_txn_id, created_txn_id from bank_feed_txns where feed_account_id = $1",
    [feedId],
  );

  it("suggests the other side, records one transfer, and clears both lines", async () => {
    const bankRow = (await rowOf(bankFeed))!;
    const cardRow = (await rowOf(cardFeed))!;
    const feed = await getFeedAccount(null, companyId, bankFeed);
    const s = (await suggestionsFor(companyId, feed, [bankRow])).get(bankRow.id)!;
    expect(s.find((x) => x.kind === "transfer")).toMatchObject({ txnId: cardRow.id, label: "Transfer to Business Credit Card" });

    const txnId = await tx((db) => matchTransferPair(db, companyId, userId, feed, bankRow.id, cardRow.id));
    const t = await one<{ type: string; total_cents: number }>("select type, total_cents from transactions where id = $1", [txnId]);
    expect(t).toEqual({ type: "transfer", total_cents: 50000 });
    expect((await rowOf(cardFeed))!).toMatchObject({ status: "categorized", matched_txn_id: txnId });
    const cleared = await query<{ account_id: string; reconcile_status: string }>("select account_id, reconcile_status from ledger_entries where transaction_id = $1", [txnId]);
    expect(cleared.every((e) => e.reconcile_status === "cleared")).toBe(true);
    expect(new Set(cleared.map((e) => e.account_id))).toEqual(new Set([acct["Business Checking"], acct["Business Credit Card"]]));

    // undo puts both lines back
    await tx((db) => undoReview(db, companyId, userId, bankRow.id));
    expect((await rowOf(bankFeed))!.status).toBe("for_review");
    expect((await rowOf(cardFeed))!).toMatchObject({ status: "for_review", matched_txn_id: null });
    expect(await one("select 1 from transactions where id = $1", [txnId])).toBeNull();
  });
});
