"use server";

import { hash } from "@node-rs/argon2";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import type { ActionResult } from "../actions";

const companySchema = z.object({
  name: z.string().trim().min(1, "Enter the business name.").max(200),
  legalName: z.string().trim().max(200).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]).optional(),
  phone: z.string().trim().max(40).optional(),
  ein: z.string().trim().max(20).optional(),
  address: z.object({ line1: z.string().max(200), line2: z.string().max(200), city: z.string().max(100), state: z.string().max(50), zip: z.string().max(20) }),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  accountingMethod: z.enum(["accrual", "cash"]),
  timezone: z.string().min(1).max(64),
});

async function audit(companyId: string, userId: string, after: unknown) {
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'company', $1, 'update', $3)", [companyId, userId, JSON.stringify(after)]);
}

export async function saveCompanySettingsAction(companyId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "admin");
  const parsed = companySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const c = parsed.data;
  await query(
    `update companies set name = $2, legal_name = $3, email = $4, phone = $5, ein = $6, address = $7,
       fiscal_year_start_month = $8, accounting_method = $9, timezone = $10 where id = $1`,
    [companyId, c.name, c.legalName || null, c.email || null, c.phone || null, c.ein || null, JSON.stringify(c.address), c.fiscalYearStartMonth, c.accountingMethod, c.timezone],
  );
  await audit(companyId, ctx.userId, { ...c, ein: c.ein ? "(set)" : null });
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: null };
}

const closeSchema = z.object({
  closeDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  password: z.string().max(200).optional(),
});

/** Set or clear the closing date. A password is required to set one. */
export async function setCloseDateAction(companyId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "accountant");
  const parsed = closeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Enter a valid date." };
  const { closeDate, password } = parsed.data;
  if (!closeDate) {
    await query("update companies set close_date = null, close_password_hash = null where id = $1", [companyId]);
    await audit(companyId, ctx.userId, { close_date: null });
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  }
  const existing = await one<{ close_password_hash: string | null }>("select close_password_hash from companies where id = $1", [companyId]);
  if (!password && !existing?.close_password_hash) return { ok: false, error: "Set a password. Anyone changing a closed period will need it." };
  if (password && password.length < 6) return { ok: false, error: "Use at least 6 characters for the close-books password." };
  await query("update companies set close_date = $2, close_password_hash = coalesce($3, close_password_hash) where id = $1", [
    companyId,
    closeDate,
    password ? await hash(password) : null,
  ]);
  await audit(companyId, ctx.userId, { close_date: closeDate });
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: null };
}

const taxSchema = z.object({
  name: z.string().trim().min(1, "Name the rate.").max(60),
  agency: z.string().trim().min(1, "Name the tax agency.").max(100),
  ratePercent: z.coerce.number().min(0).max(100),
});

export async function addTaxRateAction(companyId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "admin");
  const parsed = taxSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const t = parsed.data;
  try {
    await query("insert into tax_rates (company_id, name, agency, rate_bp) values ($1, $2, $3, $4)", [companyId, t.name, t.agency, Math.round(t.ratePercent * 100)]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, error: "A rate with that name already exists." };
    throw e;
  }
  await audit(companyId, ctx.userId, { tax_rate_added: t });
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: null };
}
