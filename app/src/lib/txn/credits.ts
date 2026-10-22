import "server-only";
import { one, query, tx } from "@/db";
import { refreshBalances, UserError } from "./save";

// Applying a credit (credit memo, vendor credit, or the unapplied part of a
// payment) to an open invoice or bill. Both sides already sit in A/R (or A/P)
// for the same name, so nothing posts to the ledger: only open balances move.

const PAIRS: Record<string, string> = { credit_memo: "invoice", payment: "invoice", vendor_credit: "bill", bill_payment: "bill" };

export async function listCredits(companyId: string, contactId: string, side: "ar" | "ap") {
  return query<{ id: string; type: string; number: string | null; txn_date: string; balance_cents: number }>(
    `select id, type, number, txn_date, balance_cents from transactions
     where company_id = $1 and contact_id = $2 and status = 'posted' and balance_cents > 0
       and type = any($3::text[]) order by txn_date, created_at`,
    [companyId, contactId, side === "ar" ? ["credit_memo", "payment"] : ["vendor_credit", "bill_payment"]],
  );
}

export async function applyCredit(companyId: string, userId: string, sourceId: string, targetId: string, amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new UserError("Enter an amount to apply.");
  await tx(async (db) => {
    const rows = await query<{ id: string; type: string; contact_id: string; balance_cents: number; status: string; number: string | null }>(
      "select id, type, contact_id, balance_cents, status, number from transactions where company_id = $1 and id = any($2::uuid[]) order by id for update",
      [companyId, [sourceId, targetId]],
      db,
    );
    const src = rows.find((r) => r.id === sourceId);
    const tgt = rows.find((r) => r.id === targetId);
    if (!src || !tgt || src.status !== "posted" || tgt.status !== "posted") throw new UserError("One of these no longer exists.");
    if (PAIRS[src.type] !== tgt.type) throw new UserError("That credit can't be applied to this.");
    if (src.contact_id !== tgt.contact_id) throw new UserError("The credit belongs to someone else.");
    if (amountCents > src.balance_cents) throw new UserError(`Only ${(src.balance_cents / 100).toFixed(2)} of that credit is left.`);
    if (amountCents > tgt.balance_cents) throw new UserError(`Only ${(tgt.balance_cents / 100).toFixed(2)} is open.`);
    await query(
      `insert into payment_applications (company_id, source_txn_id, target_txn_id, amount_cents) values ($1, $2, $3, $4)
       on conflict (source_txn_id, target_txn_id) do update set amount_cents = payment_applications.amount_cents + excluded.amount_cents`,
      [companyId, sourceId, targetId, amountCents],
      db,
    );
    await refreshBalances(db, [sourceId, targetId]);
    await query(
      "insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'transaction', $3, 'update', $4)",
      [companyId, userId, targetId, JSON.stringify({ type: tgt.type, number: tgt.number, credit_applied_from: sourceId, amount_cents: amountCents })],
      db,
    );
  });
}

/** Remove a credit application (not a payment's own application: edit the payment for that). */
export async function unapplyCredit(companyId: string, userId: string, sourceId: string, targetId: string) {
  await tx(async (db) => {
    const src = await one<{ type: string }>("select type from transactions where company_id = $1 and id = $2", [companyId, sourceId], db);
    if (!src) throw new UserError("That credit no longer exists.");
    await query("delete from payment_applications where company_id = $1 and source_txn_id = $2 and target_txn_id = $3", [companyId, sourceId, targetId], db);
    await refreshBalances(db, [sourceId, targetId]);
    await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'transaction', $3, 'update', $4)", [
      companyId,
      userId,
      targetId,
      JSON.stringify({ credit_unapplied_from: sourceId }),
    ]);
  });
}
