"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query, tx } from "@/db";
import { requireCompany } from "@/lib/authz";
import { createExpenseFromReceipt, matchReceipt } from "@/lib/receipts";
import { removeFile } from "@/lib/storage";
import { UserError } from "@/lib/txn/save";
import type { ActionResult } from "../actions";

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UserError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong saving that. Try again." };
}
const done = (companyId: string) => revalidatePath(`/c/${companyId}/receipts`);

/** Files already uploaded as attachments become receipts waiting for review. */
export async function addReceiptsAction(companyId: string, attachmentIds: string[]): Promise<ActionResult<{ added: number }>> {
  await requireCompany(companyId, "standard");
  const ids = z.array(z.string().uuid()).max(50).parse(attachmentIds);
  const rows = await query<{ id: string }>(
    `insert into receipts (company_id, attachment_id)
     select company_id, id from attachments where company_id = $1 and id = any($2::uuid[]) and transaction_id is null
       and content_type in ('application/pdf','image/png','image/jpeg','image/heic','image/webp')
       and not exists (select 1 from receipts r where r.attachment_id = attachments.id)
     returning id`,
    [companyId, ids],
  );
  done(companyId);
  return { ok: true, data: { added: rows.length } };
}

const details = z.object({
  vendorName: z.string().trim().max(200).optional().default(""),
  txnDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  amountCents: z.number().int().positive().nullable().optional(),
});

/** Save what's on the receipt, so the inbox can look for matches. */
export async function updateReceiptAction(companyId: string, id: string, raw: unknown): Promise<ActionResult<null>> {
  await requireCompany(companyId, "standard");
  const p = details.safeParse(raw);
  if (!p.success) return { ok: false, error: "Check the date and amount." };
  await query("update receipts set vendor_name = $3, txn_date = $4, amount_cents = $5, updated_at = now() where company_id = $1 and id = $2 and status = 'review'", [
    companyId,
    id,
    p.data.vendorName || null,
    p.data.txnDate || null,
    p.data.amountCents ?? null,
  ]);
  done(companyId);
  return { ok: true, data: null };
}

export async function matchReceiptAction(companyId: string, id: string, txnId: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    await tx((db) => matchReceipt(db, companyId, id, txnId));
    await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'receipt', $3, 'update', $4)", [companyId, ctx.userId, id, JSON.stringify({ matched: txnId })]);
    done(companyId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  vendorName: z.string().trim().min(1, "Enter who you paid.").max(200),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date."),
  amountCents: z.number({ message: "Enter the amount." }).int().positive("Enter the amount."),
  paymentAccountId: z.string().uuid("Choose how you paid."),
  categoryAccountId: z.string().uuid("Choose a category."),
});

export async function createExpenseFromReceiptAction(companyId: string, id: string, raw: unknown): Promise<ActionResult<{ txnId: string }>> {
  const ctx = await requireCompany(companyId, "standard");
  const p = createSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  try {
    const txnId = await tx((db) => createExpenseFromReceipt(db, companyId, ctx.userId, id, p.data));
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: { txnId } };
  } catch (e) {
    return fail(e);
  }
}

/** Throw a receipt away (the file too). */
export async function deleteReceiptAction(companyId: string, id: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  const r = await one<{ attachment_id: string; status: string }>("select attachment_id, status from receipts where company_id = $1 and id = $2", [companyId, id]);
  if (!r) return { ok: true, data: null };
  if (r.status !== "review") return { ok: false, error: "This receipt is attached to a transaction. Remove it from there instead." };
  const a = await one<{ storage_key: string }>("delete from attachments where id = $1 returning storage_key", [r.attachment_id]); // cascades to the receipt
  if (a) await removeFile(a.storage_key);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action) values ($1, $2, 'receipt', $3, 'delete')", [companyId, ctx.userId, id]);
  done(companyId);
  return { ok: true, data: null };
}
