import "server-only";
import type { PoolClient } from "pg";
import { one, query } from "@/db";
import { saveInDb, txnInput, UserError } from "@/lib/txn/save";

// Reconciliation: tick the ledger entries that appear on a bank or card
// statement until cleared balance = statement balance, then lock them.
// Balances are in the account's natural sign: money in the bank, or owed on the card.

export interface ReconAccount {
  id: string;
  name: string;
  type: "bank" | "credit_card";
}

const sign = (type: string) => (type === "credit_card" ? -1 : 1); // natural = sign × (debit − credit)

async function account(db: PoolClient | null, companyId: string, accountId: string): Promise<ReconAccount> {
  const a = await one<ReconAccount>("select id, name, type from accounts where company_id = $1 and id = $2 and type in ('bank','credit_card')", [companyId, accountId], db ?? undefined);
  if (!a) throw new UserError("Choose a bank or credit card account to reconcile.");
  return a;
}

/** The ending balance of the last completed reconciliation, and what the ledger says it should be now. */
export async function lastReconciled(db: PoolClient | null, companyId: string, accountId: string) {
  const a = await account(db, companyId, accountId);
  const last = await one<{ id: string; statement_date: string; ending_balance_cents: number }>(
    "select id, statement_date, ending_balance_cents from reconciliations where account_id = $1 and status = 'completed' order by statement_date desc, completed_at desc limit 1",
    [accountId],
    db ?? undefined,
  );
  const now = await one<{ v: number }>(
    "select coalesce(sum(debit_cents - credit_cents), 0)::bigint as v from ledger_entries where account_id = $1 and reconcile_status = 'reconciled'",
    [accountId],
    db ?? undefined,
  );
  const reconciledNow = sign(a.type) * now!.v;
  return {
    account: a,
    last,
    beginningCents: last?.ending_balance_cents ?? 0,
    /** if a reconciled transaction was changed or deleted since, these differ */
    reconciledNowCents: reconciledNow,
  };
}

export async function startReconciliation(db: PoolClient, companyId: string, accountId: string, statementDate: string, endingCents: number) {
  const open = await one<{ id: string }>("select id from reconciliations where account_id = $1 and status = 'in_progress'", [accountId], db);
  if (open) return open.id;
  const info = await lastReconciled(db, companyId, accountId);
  if (info.last && statementDate <= info.last.statement_date) throw new UserError(`This account is already reconciled through ${info.last.statement_date}. Pick a later statement date.`);
  const r = await one<{ id: string }>(
    `insert into reconciliations (company_id, account_id, statement_date, beginning_balance_cents, ending_balance_cents)
     values ($1, $2, $3, $4, $5) returning id`,
    [companyId, accountId, statementDate, info.reconciledNowCents, endingCents],
    db,
  );
  // Entries already cleared by the bank feed start ticked.
  await query(
    `update ledger_entries set reconciliation_id = $1
     where account_id = $2 and reconcile_status = 'cleared' and reconciliation_id is null and entry_date <= $3`,
    [r!.id, accountId, statementDate],
    db,
  );
  return r!.id;
}

export interface ReconEntry {
  id: string;
  entry_date: string;
  type: string;
  transaction_id: string;
  number: string | null;
  payee: string | null;
  memo: string | null;
  amount_cents: number; // natural sign: + increases the balance
  ticked: boolean;
}

export async function workspace(companyId: string, reconId: string) {
  const r = await one<{ id: string; account_id: string; statement_date: string; beginning_balance_cents: number; ending_balance_cents: number; status: string; completed_at: Date | null }>(
    "select id, account_id, statement_date, beginning_balance_cents, ending_balance_cents, status, completed_at from reconciliations where company_id = $1 and id = $2",
    [companyId, reconId],
  );
  if (!r) return null;
  const a = await account(null, companyId, r.account_id);
  const s = sign(a.type);
  const entries = await query<ReconEntry>(
    `select e.id, e.entry_date, t.type, e.transaction_id, t.number, c.display_name as payee, coalesce(e.memo, t.memo) as memo,
            ($3::int * (e.debit_cents - e.credit_cents))::bigint as amount_cents,
            e.reconciliation_id = $2 as ticked
     from ledger_entries e join transactions t on t.id = e.transaction_id left join contacts c on c.id = coalesce(e.contact_id, t.contact_id)
     where e.account_id = $1 and (
       -- in progress: everything not yet reconciled up to the statement date, plus anything ticked
       ($4 = 'in_progress' and e.reconcile_status <> 'reconciled' and (e.entry_date <= $5 or e.reconciliation_id = $2))
       -- finished: exactly what was reconciled
       or ($4 <> 'in_progress' and e.reconciliation_id = $2))
     order by e.entry_date, t.number nulls last`,
    [a.id, r.id, s, r.status, r.statement_date],
  );
  const clearedSum = entries.filter((e) => e.ticked).reduce((t, e) => t + e.amount_cents, 0);
  const cleared = r.beginning_balance_cents + clearedSum;
  return {
    recon: r,
    account: a,
    entries,
    clearedCents: cleared,
    differenceCents: r.ending_balance_cents - cleared,
    depositsCents: entries.filter((e) => e.ticked && e.amount_cents > 0).reduce((t, e) => t + e.amount_cents, 0),
    paymentsCents: -entries.filter((e) => e.ticked && e.amount_cents < 0).reduce((t, e) => t + e.amount_cents, 0),
  };
}

export async function tick(db: PoolClient, companyId: string, reconId: string, entryIds: string[], on: boolean) {
  const r = await one<{ account_id: string; status: string }>("select account_id, status from reconciliations where company_id = $1 and id = $2 for update", [companyId, reconId], db);
  if (!r || r.status !== "in_progress") throw new UserError("This reconciliation is finished.");
  if (on) {
    await query(
      "update ledger_entries set reconciliation_id = $1 where account_id = $2 and id = any($3::uuid[]) and reconcile_status <> 'reconciled'",
      [reconId, r.account_id, entryIds],
      db,
    );
  } else {
    await query("update ledger_entries set reconciliation_id = null where reconciliation_id = $1 and id = any($2::uuid[])", [reconId, entryIds], db);
  }
}

export async function editStatement(db: PoolClient, companyId: string, reconId: string, statementDate: string, endingCents: number) {
  const r = await one("select 1 from reconciliations where company_id = $1 and id = $2 and status = 'in_progress' for update", [companyId, reconId], db);
  if (!r) throw new UserError("This reconciliation is finished.");
  await query("update reconciliations set statement_date = $2, ending_balance_cents = $3 where id = $1", [reconId, statementDate, endingCents], db);
}

/** Finish. A leftover difference can be booked as an adjustment if the user says so. */
export async function finish(db: PoolClient, companyId: string, userId: string, reconId: string, allowAdjustment: boolean) {
  const r = await one<{ account_id: string; status: string; statement_date: string }>(
    "select account_id, status, statement_date from reconciliations where company_id = $1 and id = $2 for update",
    [companyId, reconId],
    db,
  );
  if (!r || r.status !== "in_progress") throw new UserError("This reconciliation is already finished.");
  const a = await account(db, companyId, r.account_id);
  const s = sign(a.type);
  const sum = await one<{ v: number }>("select coalesce(sum(debit_cents - credit_cents), 0)::bigint as v from ledger_entries where reconciliation_id = $1", [reconId], db);
  const rec = await one<{ beginning_balance_cents: number; ending_balance_cents: number }>("select beginning_balance_cents, ending_balance_cents from reconciliations where id = $1", [reconId], db);
  const diff = rec!.ending_balance_cents - (rec!.beginning_balance_cents + s * sum!.v);
  if (diff !== 0) {
    if (!allowAdjustment) throw new UserError(`The difference is ${(diff / 100).toFixed(2)}. Find it, or finish with an adjustment.`);
    let adj = await one<{ id: string }>("select id from accounts where company_id = $1 and lower(name) = 'reconciliation discrepancies'", [companyId], db);
    if (!adj) adj = await one<{ id: string }>("insert into accounts (company_id, name, type, detail_type) values ($1, 'Reconciliation Discrepancies', 'other_expense', 'other_miscellaneous_expense') returning id", [companyId], db);
    // diff > 0 means the statement shows more than the books: raise the account's natural balance
    const raise = diff > 0;
    const accountSide = (raise ? 1 : -1) * s > 0 ? "debit" : "credit";
    const saved = await saveInDb(
      db,
      companyId,
      userId,
      txnInput.parse({
        type: "journal_entry",
        txnDate: r.statement_date,
        memo: "Reconciliation adjustment",
        lines: [
          { accountId: r.account_id, amountCents: Math.abs(diff), side: accountSide },
          { accountId: adj!.id, amountCents: Math.abs(diff), side: accountSide === "debit" ? "credit" : "debit" },
        ],
      }),
    );
    await query("update ledger_entries set reconciliation_id = $1 where transaction_id = $2 and account_id = $3", [reconId, saved.id, r.account_id], db);
  }
  await query("update ledger_entries set reconcile_status = 'reconciled' where reconciliation_id = $1", [reconId], db);
  await query("update reconciliations set status = 'completed', completed_at = now(), completed_by = $2 where id = $1", [reconId, userId], db);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'reconciliation', $3, 'reconcile', $4)", [
    companyId,
    userId,
    reconId,
    JSON.stringify({ account: a.name, statement_date: r.statement_date, adjustment_cents: diff }),
  ]);
  return { adjustmentCents: diff };
}

/** Undo the most recent completed reconciliation for its account. */
export async function undoLast(db: PoolClient, companyId: string, userId: string, reconId: string) {
  const r = await one<{ account_id: string; status: string }>("select account_id, status from reconciliations where company_id = $1 and id = $2 for update", [companyId, reconId], db);
  if (!r || r.status !== "completed") throw new UserError("Only a finished reconciliation can be undone.");
  const latest = await one<{ id: string }>(
    "select id from reconciliations where account_id = $1 and status = 'completed' order by statement_date desc, completed_at desc limit 1",
    [r.account_id],
    db,
  );
  if (latest?.id !== reconId) throw new UserError("Undo the most recent reconciliation first.");
  const open = await one("select 1 from reconciliations where account_id = $1 and status = 'in_progress'", [r.account_id], db);
  if (open) throw new UserError("Finish or delete the reconciliation in progress first.");
  await query("update ledger_entries set reconcile_status = 'cleared', reconciliation_id = null where reconciliation_id = $1", [reconId], db);
  await query("update reconciliations set status = 'undone' where id = $1", [reconId], db);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action) values ($1, $2, 'reconciliation', $3, 'unreconcile')", [companyId, userId, reconId]);
}

export async function discard(db: PoolClient, companyId: string, reconId: string) {
  const r = await one("select 1 from reconciliations where company_id = $1 and id = $2 and status = 'in_progress'", [companyId, reconId], db);
  if (!r) throw new UserError("Only a reconciliation in progress can be discarded.");
  await query("update ledger_entries set reconciliation_id = null where reconciliation_id = $1", [reconId], db);
  await query("delete from reconciliations where id = $1", [reconId], db);
}
