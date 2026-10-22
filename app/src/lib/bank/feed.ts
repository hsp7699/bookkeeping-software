import "server-only";
import type { PoolClient } from "pg";
import { one, query } from "@/db";
import { saveInDb, txnInput, UserError } from "@/lib/txn/save";
import type { BankRow } from "./parse";
import { firstMatchingRule, splitAmounts, type Rule } from "./rules";

// The bank feed: rows from a file (or later, an aggregator) wait "for review"
// until they're added as a new transaction, matched to an existing one, or excluded.

export interface FeedAccount {
  id: string;
  account_id: string;
  name: string;
  type: "bank" | "credit_card";
}

export async function getFeedAccount(db: PoolClient | null, companyId: string, feedAccountId: string): Promise<FeedAccount> {
  const f = await one<FeedAccount>(
    `select f.id, f.account_id, a.name, a.type from bank_feed_accounts f join accounts a on a.id = f.account_id
     where f.company_id = $1 and f.id = $2`,
    [companyId, feedAccountId],
    db ?? undefined,
  );
  if (!f) throw new UserError("That bank account isn't connected any more.");
  return f;
}

export async function loadRules(db: PoolClient | null, companyId: string): Promise<Rule[]> {
  const rows = await query<{
    id: string;
    name: string;
    priority: number;
    direction: Rule["direction"];
    feed_account_ids: string[] | null;
    match_mode: Rule["matchMode"];
    conditions: Rule["conditions"];
    actions: Rule["actions"];
    auto_confirm: boolean;
  }>("select * from bank_rules where company_id = $1 and active order by priority", [companyId], db ?? undefined);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    direction: r.direction,
    feedAccountIds: r.feed_account_ids,
    matchMode: r.match_mode,
    conditions: r.conditions,
    actions: r.actions,
    autoConfirm: r.auto_confirm,
  }));
}

/** Insert parsed rows, skipping ones already imported. Applies rules to the new rows. */
export async function importRows(
  db: PoolClient,
  companyId: string,
  userId: string,
  feedAccountId: string,
  file: { name: string; format: string; columnMap: unknown },
  rows: BankRow[],
  ledgerBalanceCents: number | null,
) {
  const feed = await getFeedAccount(db, companyId, feedAccountId);
  const imp = await one<{ id: string }>(
    `insert into bank_imports (company_id, feed_account_id, file_name, format, column_map, rows_total, imported_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [companyId, feedAccountId, file.name.slice(0, 200), file.format, file.columnMap ? JSON.stringify(file.columnMap) : null, rows.length, userId],
    db,
  );
  const rules = await loadRules(db, companyId);
  let added = 0;
  let autoAdded = 0;
  for (const r of rows) {
    const rule = firstMatchingRule(rules, { feedAccountId, description: r.description, bankText: r.bankText, amountCents: r.amountCents });
    const row = await one<{ id: string }>(
      `insert into bank_feed_txns (company_id, feed_account_id, import_id, external_id, posted_date, description, bank_text, amount_cents, rule_id, suggested)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (feed_account_id, external_id) do nothing returning id`,
      [companyId, feedAccountId, imp!.id, r.externalId, r.date, r.description, r.bankText, r.amountCents, rule?.id ?? null, rule ? JSON.stringify(ruleSuggestion(rule, r.amountCents)) : null],
      db,
    );
    if (!row) continue;
    added++;
    if (rule?.autoConfirm) {
      await addFromFeed(db, companyId, userId, feed, row.id, ruleSuggestion(rule, r.amountCents));
      autoAdded++;
    }
  }
  await query("update bank_imports set rows_added = $2, rows_duplicate = $3 where id = $1", [imp!.id, added, rows.length - added], db);
  await query(
    "update bank_feed_accounts set last_synced_at = now(), last_balance_cents = coalesce($2, last_balance_cents) where id = $1",
    [feedAccountId, ledgerBalanceCents],
    db,
  );
  return { added, duplicates: rows.length - added, autoAdded };
}

export interface AddSpec {
  kind: "categorize" | "transfer";
  contactId?: string | null;
  memo?: string | null;
  /** categorize: category lines that sum to the row amount (positive cents) */
  lines?: { accountId: string; amountCents: number; description?: string | null }[];
  /** transfer: the other account */
  otherAccountId?: string | null;
  ruleId?: string | null;
}

function ruleSuggestion(rule: Rule, amountCents: number): AddSpec {
  return {
    kind: rule.actions.txnType === "transfer" ? "transfer" : "categorize",
    contactId: rule.actions.contactId ?? null,
    memo: rule.actions.memo ?? null,
    lines: rule.actions.txnType === "transfer" ? undefined : splitAmounts(rule.actions.splits, amountCents),
    otherAccountId: rule.actions.txnType === "transfer" ? rule.actions.splits[0]?.accountId ?? null : null,
    ruleId: rule.id,
  };
}

async function lockRow(db: PoolClient, companyId: string, rowId: string) {
  const row = await one<{ id: string; feed_account_id: string; posted_date: string; description: string; amount_cents: number; status: string }>(
    "select id, feed_account_id, posted_date, description, amount_cents, status from bank_feed_txns where company_id = $1 and id = $2 for update",
    [companyId, rowId],
    db,
  );
  if (!row) throw new UserError("That bank transaction no longer exists.");
  if (row.status !== "for_review") throw new UserError("That bank transaction was already reviewed.");
  return row;
}

async function markCleared(db: PoolClient, txnId: string, accountId: string) {
  await query("update ledger_entries set reconcile_status = 'cleared' where transaction_id = $1 and account_id = $2 and reconcile_status = 'uncleared'", [txnId, accountId], db);
}

/** "Add": create a new transaction for the bank row. */
export async function addFromFeed(db: PoolClient, companyId: string, userId: string, feed: FeedAccount, rowId: string, spec: AddSpec) {
  const row = await lockRow(db, companyId, rowId);
  const inflow = row.amount_cents > 0;
  const abs = Math.abs(row.amount_cents);
  const memo = spec.memo ?? row.description;
  let input;
  if (spec.kind === "transfer") {
    if (!spec.otherAccountId) throw new UserError("Choose the other account for the transfer.");
    input = {
      type: "transfer",
      txnDate: row.posted_date,
      accountId: inflow ? feed.account_id : spec.otherAccountId,
      fromAccountId: inflow ? spec.otherAccountId : feed.account_id,
      amountCents: abs,
      memo,
      source: "bank_feed",
    };
  } else {
    const lines = spec.lines?.filter((l) => l.amountCents !== 0) ?? [];
    if (lines.length === 0) throw new UserError("Choose a category.");
    const sum = lines.reduce((s, l) => s + l.amountCents, 0);
    if (sum !== abs) throw new UserError(`The split adds up to ${(sum / 100).toFixed(2)}, not ${(abs / 100).toFixed(2)}.`);
    const type = !inflow ? "expense" : feed.type === "credit_card" ? "credit_card_credit" : "deposit";
    input = {
      type,
      txnDate: row.posted_date,
      accountId: feed.account_id,
      contactId: spec.contactId ?? null,
      memo,
      lines: lines.map((l) => ({ accountId: l.accountId, amountCents: l.amountCents, description: l.description ?? null, contactId: type === "deposit" ? spec.contactId ?? null : null })),
      source: "bank_feed",
    };
  }
  const saved = await saveInDb(db, companyId, userId, txnInput.parse(input));
  await markCleared(db, saved.id, feed.account_id);
  await query(
    "update bank_feed_txns set status = 'categorized', created_txn_id = $2, rule_id = coalesce($3, rule_id), reviewed_by = $4, reviewed_at = now() where id = $1",
    [rowId, saved.id, spec.ruleId ?? null, userId],
    db,
  );
  return saved.id;
}

/** "Match": link the bank row to a transaction already in the books. */
export async function matchExisting(db: PoolClient, companyId: string, userId: string, feed: FeedAccount, rowId: string, txnId: string) {
  const row = await lockRow(db, companyId, rowId);
  const hit = await one<{ net: number }>(
    `select coalesce(sum(debit_cents - credit_cents), 0)::bigint as net from ledger_entries where transaction_id = $1 and account_id = $2 and company_id = $3`,
    [txnId, feed.account_id, companyId],
    db,
  );
  if (!hit || hit.net !== row.amount_cents) throw new UserError("That transaction doesn't move the same amount through this account.");
  const taken = await one("select 1 from bank_feed_txns where (matched_txn_id = $1 or created_txn_id = $1) and id <> $2", [txnId, rowId], db);
  if (taken) throw new UserError("That transaction is already matched to another bank line.");
  await markCleared(db, txnId, feed.account_id);
  await query("update bank_feed_txns set status = 'categorized', matched_txn_id = $2, reviewed_by = $3, reviewed_at = now() where id = $1", [rowId, txnId, userId], db);
}

/** Match a deposit to an open invoice (records the payment) or a withdrawal to an open bill (records the bill payment). */
export async function matchOpenDocument(db: PoolClient, companyId: string, userId: string, feed: FeedAccount, rowId: string, docId: string) {
  const row = await lockRow(db, companyId, rowId);
  const doc = await one<{ type: string; contact_id: string; balance_cents: number; number: string | null }>(
    "select type, contact_id, balance_cents, number from transactions where company_id = $1 and id = $2 and status = 'posted' for update",
    [companyId, docId],
    db,
  );
  if (!doc || (doc.type !== "invoice" && doc.type !== "bill")) throw new UserError("That invoice or bill no longer exists.");
  const abs = Math.abs(row.amount_cents);
  if ((doc.type === "invoice") !== row.amount_cents > 0) throw new UserError(doc.type === "invoice" ? "Only money coming in can pay an invoice." : "Only money going out can pay a bill.");
  if (abs > doc.balance_cents) throw new UserError(`Only ${(doc.balance_cents / 100).toFixed(2)} is open on that ${doc.type}.`);
  const saved = await saveInDb(
    db,
    companyId,
    userId,
    txnInput.parse({
      type: doc.type === "invoice" ? "payment" : "bill_payment",
      contactId: doc.contact_id,
      txnDate: row.posted_date,
      accountId: feed.account_id,
      amountCents: abs,
      applications: [{ txnId: docId, amountCents: abs }],
      memo: row.description,
      source: "bank_feed",
    }),
  );
  await markCleared(db, saved.id, feed.account_id);
  await query("update bank_feed_txns set status = 'categorized', created_txn_id = $2, reviewed_by = $3, reviewed_at = now() where id = $1", [rowId, saved.id, userId], db);
}

/**
 * Both sides of a transfer between two connected accounts: record one transfer
 * from this line, and mark the other account's line as matched to it.
 */
export async function matchTransferPair(db: PoolClient, companyId: string, userId: string, feed: FeedAccount, rowId: string, otherRowId: string) {
  const other = await one<{ feed_account_id: string; amount_cents: number; posted_date: string; status: string }>(
    "select feed_account_id, amount_cents, posted_date::text, status from bank_feed_txns where company_id = $1 and id = $2 for update",
    [companyId, otherRowId],
    db,
  );
  if (!other || other.status !== "for_review") throw new UserError("The other side of that transfer was already reviewed.");
  const row = await lockRow(db, companyId, rowId);
  if (other.feed_account_id === row.feed_account_id || other.amount_cents !== -row.amount_cents) throw new UserError("Those two bank lines aren't the same transfer.");
  const otherFeed = await getFeedAccount(db, companyId, other.feed_account_id);
  const txnId = await addFromFeed(db, companyId, userId, feed, rowId, { kind: "transfer", otherAccountId: otherFeed.account_id, memo: row.description });
  await markCleared(db, txnId, otherFeed.account_id);
  await query("update bank_feed_txns set status = 'categorized', matched_txn_id = $2, reviewed_by = $3, reviewed_at = now() where id = $1", [otherRowId, txnId, userId], db);
  return txnId;
}

/** Back to "for review". A transaction the feed created is deleted; a matched one is just unlinked. */
export async function undoReview(db: PoolClient, companyId: string, userId: string, rowId: string) {
  const row = await one<{ status: string; created_txn_id: string | null; matched_txn_id: string | null; feed_account_id: string }>(
    "select status, created_txn_id, matched_txn_id, feed_account_id from bank_feed_txns where company_id = $1 and id = $2 for update",
    [companyId, rowId],
    db,
  );
  if (!row) throw new UserError("That bank transaction no longer exists.");
  const feed = await getFeedAccount(db, companyId, row.feed_account_id);
  if (row.matched_txn_id) {
    const rec = await one("select 1 from ledger_entries where transaction_id = $1 and account_id = $2 and reconcile_status = 'reconciled'", [row.matched_txn_id, feed.account_id], db);
    if (rec) throw new UserError("This was reconciled. Undo the reconciliation first.");
    await query("update ledger_entries set reconcile_status = 'uncleared' where transaction_id = $1 and account_id = $2", [row.matched_txn_id, feed.account_id], db);
  }
  await query("update bank_feed_txns set status = 'for_review', created_txn_id = null, matched_txn_id = null, reviewed_by = $2, reviewed_at = now() where id = $1", [rowId, userId], db);
  if (row.created_txn_id) {
    // the other side of a transfer goes back to review with it
    await query("update bank_feed_txns set status = 'for_review', matched_txn_id = null, reviewed_by = $2, reviewed_at = now() where matched_txn_id = $1", [row.created_txn_id, userId], db);
    const before = await one("select * from transactions where id = $1", [row.created_txn_id], db);
    const targets = (await query<{ target_txn_id: string }>("select target_txn_id from payment_applications where source_txn_id = $1", [row.created_txn_id], db)).map((r) => r.target_txn_id);
    await query("delete from transactions where id = $1", [row.created_txn_id], db);
    const { refreshBalances } = await import("@/lib/txn/save");
    await refreshBalances(db, targets);
    await query("insert into audit_events (company_id, user_id, entity, entity_id, action, before) values ($1, $2, 'transaction', $3, 'delete', $4)", [
      companyId,
      userId,
      row.created_txn_id,
      JSON.stringify(before),
    ]);
  }
}

export interface Suggestion {
  kind: "match" | "invoice" | "bill" | "rule" | "transfer";
  /** for "transfer", the other account's bank line */
  txnId?: string;
  label: string;
  detail: string;
}

/**
 * Match suggestions for rows waiting for review: existing transactions that
 * move the same amount through this account within ±10 days, and open
 * invoices or bills for exactly the amount. Never matched automatically.
 */
export async function suggestionsFor(companyId: string, feed: FeedAccount, rows: { id: string; posted_date: string; amount_cents: number }[]) {
  if (rows.length === 0) return new Map<string, Suggestion[]>();
  const amounts = [...new Set(rows.map((r) => r.amount_cents))];
  const existing = await query<{ id: string; type: string; number: string | null; txn_date: string; net: number; contact: string | null }>(
    `select t.id, t.type, t.number, t.txn_date, sum(e.debit_cents - e.credit_cents)::bigint as net, c.display_name as contact
     from ledger_entries e join transactions t on t.id = e.transaction_id left join contacts c on c.id = t.contact_id
     where e.company_id = $1 and e.account_id = $2 and e.reconcile_status = 'uncleared'
       and not exists (select 1 from bank_feed_txns b where b.matched_txn_id = t.id or b.created_txn_id = t.id)
     group by t.id, c.display_name
     having sum(e.debit_cents - e.credit_cents) = any($3::bigint[])`,
    [companyId, feed.account_id, amounts],
  );
  const docs = await query<{ id: string; type: string; number: string | null; balance_cents: number; contact: string; due_date: string | null }>(
    `select t.id, t.type, t.number, t.balance_cents, c.display_name as contact, t.due_date
     from transactions t join contacts c on c.id = t.contact_id
     where t.company_id = $1 and t.status = 'posted' and t.type in ('invoice','bill') and t.balance_cents > 0
       and t.balance_cents = any($2::bigint[])`,
    [companyId, amounts.map(Math.abs)],
  );
  // the other side of a transfer: an opposite line waiting in another connected account
  const pairs = await query<{ id: string; posted_date: string; amount_cents: number; name: string }>(
    `select b.id, b.posted_date::text, b.amount_cents, a.name
     from bank_feed_txns b join bank_feed_accounts f on f.id = b.feed_account_id join accounts a on a.id = f.account_id
     where b.company_id = $1 and b.status = 'for_review' and b.feed_account_id <> $2 and b.amount_cents = any($3::bigint[])`,
    [companyId, feed.id, amounts.map((a) => -a)],
  );
  const LABEL: Record<string, string> = { payment: "Payment", deposit: "Deposit", expense: "Expense", check: "Check", bill_payment: "Bill payment", transfer: "Transfer", sales_receipt: "Sales receipt", refund_receipt: "Refund", journal_entry: "Journal entry", credit_card_credit: "Card credit" };
  const out = new Map<string, Suggestion[]>();
  const used = new Set<string>();
  for (const r of rows) {
    const list: Suggestion[] = [];
    const near = existing
      .filter((e) => e.net === r.amount_cents && !used.has(e.id) && Math.abs(Date.parse(e.txn_date) - Date.parse(r.posted_date)) <= 10 * 86400000)
      .sort((a, b) => Math.abs(Date.parse(a.txn_date) - Date.parse(r.posted_date)) - Math.abs(Date.parse(b.txn_date) - Date.parse(r.posted_date)));
    for (const e of near.slice(0, 3)) list.push({ kind: "match", txnId: e.id, label: `${LABEL[e.type] ?? e.type}${e.number ? ` ${e.number}` : ""}${e.contact ? ` · ${e.contact}` : ""}`, detail: e.txn_date });
    if (near[0]) used.add(near[0].id);
    for (const t of pairs.filter((t) => t.amount_cents === -r.amount_cents && Math.abs(Date.parse(t.posted_date) - Date.parse(r.posted_date)) <= 5 * 86400000).slice(0, 2)) {
      list.push({ kind: "transfer", txnId: t.id, label: `Transfer ${r.amount_cents > 0 ? "from" : "to"} ${t.name}`, detail: t.posted_date });
    }
    for (const d of docs.filter((d) => d.balance_cents === Math.abs(r.amount_cents) && (d.type === "invoice") === r.amount_cents > 0).slice(0, 3)) {
      list.push({ kind: d.type as "invoice" | "bill", txnId: d.id, label: `${d.type === "invoice" ? "Invoice" : "Bill"}${d.number ? ` ${d.number}` : ""} · ${d.contact}`, detail: d.due_date ?? "" });
    }
    out.set(r.id, list);
  }
  return out;
}
