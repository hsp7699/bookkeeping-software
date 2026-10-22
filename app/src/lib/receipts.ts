import "server-only";
import type { PoolClient } from "pg";
import { one, query } from "@/db";
import { saveInDb, txnInput, UserError } from "@/lib/txn/save";

// The receipts inbox: uploaded receipts wait "for review" until they're
// attached to a transaction already in the books, or turned into a new expense.
// Nothing is read off the image: you type the vendor, date and amount.

export interface ReceiptMatch {
  id: string;
  type: string;
  number: string | null;
  txn_date: string;
  total_cents: number;
  contact: string | null;
}

/** Spending transactions for the same amount within 10 days that have no attachment yet. */
export async function receiptMatches(companyId: string, receipts: { id: string; txn_date: string | null; amount_cents: number | null }[]) {
  const out = new Map<string, ReceiptMatch[]>();
  const want = receipts.filter((r) => r.amount_cents && r.txn_date);
  if (!want.length) return out;
  const cands = await query<ReceiptMatch>(
    `select t.id, t.type, t.number, t.txn_date::text, t.total_cents, c.display_name as contact
     from transactions t left join contacts c on c.id = t.contact_id
     where t.company_id = $1 and t.status = 'posted' and t.type in ('expense','check','bill','credit_card_credit')
       and t.total_cents = any($2::bigint[])
       and not exists (select 1 from attachments a where a.transaction_id = t.id)
     order by t.txn_date desc limit 500`,
    [companyId, want.map((r) => r.amount_cents)],
  );
  for (const r of want) {
    const days = (d: string) => Math.abs(Date.parse(d) - Date.parse(r.txn_date!)) / 86400000;
    out.set(
      r.id,
      cands
        .filter((c) => c.total_cents === r.amount_cents && days(c.txn_date) <= 10)
        .sort((a, b) => days(a.txn_date) - days(b.txn_date))
        .slice(0, 3),
    );
  }
  return out;
}

async function lockReceipt(db: PoolClient, companyId: string, receiptId: string) {
  const r = await one<{ id: string; attachment_id: string; status: string; vendor_name: string | null; txn_date: string | null; amount_cents: number | null }>(
    "select id, attachment_id, status, vendor_name, txn_date::text, amount_cents from receipts where company_id = $1 and id = $2 for update",
    [companyId, receiptId],
    db,
  );
  if (!r) throw new UserError("That receipt no longer exists.");
  if (r.status !== "review") throw new UserError("That receipt was already reviewed.");
  return r;
}

/** Attach the receipt to a transaction that's already in the books. */
export async function matchReceipt(db: PoolClient, companyId: string, receiptId: string, txnId: string) {
  const r = await lockReceipt(db, companyId, receiptId);
  const t = await one("select 1 from transactions where company_id = $1 and id = $2", [companyId, txnId], db);
  if (!t) throw new UserError("That transaction no longer exists.");
  await query("update attachments set transaction_id = $2 where id = $1", [r.attachment_id, txnId], db);
  await query("update receipts set status = 'matched', txn_id = $2, updated_at = now() where id = $1", [receiptId, txnId], db);
}

/** Record a new expense from the receipt, with the receipt attached. */
export async function createExpenseFromReceipt(
  db: PoolClient,
  companyId: string,
  userId: string,
  receiptId: string,
  spec: { vendorName: string; txnDate: string; amountCents: number; paymentAccountId: string; categoryAccountId: string; memo?: string | null },
) {
  await lockReceipt(db, companyId, receiptId);
  const name = spec.vendorName.trim();
  if (!name) throw new UserError("Enter who you paid.");
  let vendor = await one<{ id: string }>("select id from contacts where company_id = $1 and lower(display_name) = lower($2)", [companyId, name], db);
  if (!vendor) vendor = await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'vendor', $2) returning id", [companyId, name], db);
  const saved = await saveInDb(
    db,
    companyId,
    userId,
    txnInput.parse({
      type: "expense",
      txnDate: spec.txnDate,
      accountId: spec.paymentAccountId,
      contactId: vendor!.id,
      memo: spec.memo ?? null,
      lines: [{ accountId: spec.categoryAccountId, amountCents: spec.amountCents }],
      source: "manual",
    }),
  );
  const r = await one<{ attachment_id: string }>("select attachment_id from receipts where id = $1", [receiptId], db);
  await query("update attachments set transaction_id = $2 where id = $1", [r!.attachment_id, saved.id], db);
  await query(
    "update receipts set status = 'created', txn_id = $2, vendor_name = $3, txn_date = $4, amount_cents = $5, updated_at = now() where id = $1",
    [receiptId, saved.id, name, spec.txnDate, spec.amountCents],
    db,
  );
  return saved.id;
}
