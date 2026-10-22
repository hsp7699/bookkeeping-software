"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { deleteTransaction, saveTransaction, UserError, voidTransaction } from "@/lib/txn/save";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UserError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong saving that. Try again." };
}

function zodFail(e: z.ZodError): ActionResult<never> {
  return {
    ok: false,
    error: "Check the highlighted fields.",
    fieldErrors: Object.fromEntries(e.issues.map((i) => [String(i.path[0]), i.message])),
  };
}

const address = z
  .object({ line1: z.string().max(200).optional(), line2: z.string().max(200).optional(), city: z.string().max(100).optional(), state: z.string().max(50).optional(), zip: z.string().max(20).optional() })
  .default({});

const contactSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["customer", "vendor"]),
  displayName: z.string().trim().min(1, "Enter a name.").max(200),
  companyName: z.string().trim().max(200).optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email address.")]).optional(),
  phone: z.string().trim().max(40).optional(),
  termsId: z.union([z.literal(""), z.string().uuid()]).optional(),
  billingAddress: address,
  notes: z.string().max(4000).optional(),
  track1099: z.boolean().optional(),
});

export async function saveContactAction(companyId: string, raw: unknown): Promise<ActionResult<{ id: string; displayName: string; email: string | null; termsId: string | null }>> {
  const ctx = await requireCompany(companyId, "standard");
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const c = parsed.data;
  try {
    const dupe = await one<{ kind: string }>(
      "select kind from contacts where company_id = $1 and lower(display_name) = lower($2) and id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')",
      [companyId, c.displayName, c.id ?? null],
    );
    if (dupe) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { displayName: `A ${dupe.kind} with this name already exists. Names must be unique.` } };
    const params = [companyId, c.kind, c.displayName, c.companyName || null, c.email ? [c.email] : [], c.phone || null, c.termsId || null, JSON.stringify(c.billingAddress), c.notes || null, c.track1099 ?? false];
    const row = c.id
      ? await one<{ id: string }>(
          `update contacts set kind = $2, display_name = $3, company_name = $4, emails = $5, phone = $6, terms_id = $7, billing_address = $8, notes = $9, track_1099 = $10
           where company_id = $1 and id = $11 returning id`,
          [...params, c.id],
        )
      : await one<{ id: string }>(
          `insert into contacts (company_id, kind, display_name, company_name, emails, phone, terms_id, billing_address, notes, track_1099)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          params,
        );
    if (!row) return { ok: false, error: "That record no longer exists." };
    await query(
      "insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'contact', $3, $4, $5)",
      [companyId, ctx.userId, row.id, c.id ? "update" : "create", JSON.stringify(c)],
    );
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: { id: row.id, displayName: c.displayName, email: c.email || null, termsId: c.termsId || null } };
  } catch (e) {
    return fail(e);
  }
}

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(100),
  type: z.enum(["service", "non_inventory"]),
  sku: z.string().trim().max(100).optional(),
  description: z.string().max(4000).optional(),
  salesPriceCents: z.number().int().min(0).nullable().optional(),
  incomeAccountId: z.string().uuid("Choose an income account."),
  taxable: z.boolean().default(true),
});

export async function saveItemAction(
  companyId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string; name: string; salesPriceCents: number | null; description: string | null; taxable: boolean }>> {
  const ctx = await requireCompany(companyId, "standard");
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const i = parsed.data;
  try {
    const acct = await one<{ type: string }>("select type from accounts where company_id = $1 and id = $2", [companyId, i.incomeAccountId]);
    if (!acct || !["income", "other_income"].includes(acct.type)) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: { incomeAccountId: "Choose an income account." } };
    }
    const dupe = await one(
      "select 1 from items where company_id = $1 and lower(name) = lower($2) and id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')",
      [companyId, i.name, i.id ?? null],
    );
    if (dupe) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { name: "A product or service with this name already exists." } };
    const params = [companyId, i.name, i.type, i.sku || null, i.description || null, i.salesPriceCents ?? null, i.incomeAccountId, i.taxable];
    const row = i.id
      ? await one<{ id: string }>(
          `update items set name = $2, type = $3, sku = $4, description = $5, sales_price_cents = $6, income_account_id = $7, taxable = $8
           where company_id = $1 and id = $9 returning id`,
          [...params, i.id],
        )
      : await one<{ id: string }>(
          `insert into items (company_id, name, type, sku, description, sales_price_cents, income_account_id, taxable)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          params,
        );
    if (!row) return { ok: false, error: "That record no longer exists." };
    await query(
      "insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'item', $3, $4, $5)",
      [companyId, ctx.userId, row.id, i.id ? "update" : "create", JSON.stringify(i)],
    );
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: { id: row.id, name: i.name, salesPriceCents: i.salesPriceCents ?? null, description: i.description ?? null, taxable: i.taxable } };
  } catch (e) {
    return fail(e);
  }
}

async function checkClosePassword(companyId: string, password: string): Promise<boolean> {
  const { verify } = await import("@node-rs/argon2");
  const c = await one<{ close_password_hash: string | null }>("select close_password_hash from companies where id = $1", [companyId]);
  if (!c?.close_password_hash || !(await verify(c.close_password_hash, password))) throw new UserError("That close-books password isn't right.");
  return true;
}

export async function saveTransactionAction(
  companyId: string,
  raw: unknown,
  closePassword?: string,
): Promise<ActionResult<{ id: string; number: string | null }>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    const closeOverride = closePassword ? await checkClosePassword(companyId, closePassword) : false;
    const result = await saveTransaction(companyId, ctx.userId, raw, { closeOverride });
    if (closeOverride) await auditCloseOverride(companyId, ctx.userId, result.id);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: result };
  } catch (e) {
    return fail(e);
  }
}

export async function openInvoicesAction(companyId: string, contactId: string, paymentId?: string) {
  await requireCompany(companyId, "standard");
  // Open invoices, plus any this payment already pays (so an edit can see them)
  return query<{ id: string; number: string | null; txn_date: string; due_date: string | null; total_cents: number; balance_cents: number; applied_cents: number }>(
    `select t.id, t.number, t.txn_date, t.due_date, t.total_cents,
            t.balance_cents + coalesce(a.amount_cents, 0) as balance_cents, coalesce(a.amount_cents, 0) as applied_cents
     from transactions t
     left join payment_applications a on a.target_txn_id = t.id and a.source_txn_id = $3::uuid
     where t.company_id = $1 and t.contact_id = $2 and t.type = 'invoice' and t.status = 'posted'
       and (t.balance_cents > 0 or a.amount_cents is not null)
     order by t.due_date nulls last, t.txn_date, t.number`,
    [companyId, contactId, paymentId ?? null],
  );
}

async function auditCloseOverride(companyId: string, userId: string, txnId: string) {
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action) values ($1, $2, 'transaction', $3, 'close_override')", [companyId, userId, txnId]);
}

export async function voidTransactionAction(companyId: string, id: string, closePassword?: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    const closeOverride = closePassword ? await checkClosePassword(companyId, closePassword) : false;
    await voidTransaction(companyId, ctx.userId, id, { closeOverride });
    if (closeOverride) await auditCloseOverride(companyId, ctx.userId, id);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTransactionAction(companyId: string, id: string, closePassword?: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    const closeOverride = closePassword ? await checkClosePassword(companyId, closePassword) : false;
    await deleteTransaction(companyId, ctx.userId, id, { closeOverride });
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
