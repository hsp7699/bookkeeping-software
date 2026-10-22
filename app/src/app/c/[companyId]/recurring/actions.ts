"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { companyToday } from "@/lib/queries";
import { createOccurrence, templateFromTxn, type TemplateRow } from "@/lib/recurring/run";
import { firstOccurrence, nextOccurrence } from "@/lib/recurring/schedule";
import { txnHref } from "@/lib/routes";
import { UserError } from "@/lib/txn/save";
import type { ActionResult } from "../actions";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

const schema = z
  .object({
    id: z.string().uuid().optional(),
    txnId: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Give it a name.").max(100),
    mode: z.enum(["scheduled", "reminder"]),
    intervalUnit: z.enum(["week", "month", "year"]),
    intervalCount: z.coerce.number().int().min(1, "At least 1.").max(52, "52 at most."),
    dayOfMonth: z.coerce.number().int().min(1).max(31).nullable(),
    nextDate: date,
    endDate: z.union([z.literal(""), date]).nullable(),
    autoSend: z.boolean().default(false),
  })
  .refine((v) => !v.endDate || v.endDate >= v.nextDate, { path: ["endDate"], message: "The end date is before the first one." })
  .refine((v) => v.id || v.txnId, { path: ["name"], message: "Nothing to repeat." });

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UserError) return { ok: false, error: e.message };
  if ((e as { code?: string }).code === "23505") return { ok: false, error: "Check the highlighted fields.", fieldErrors: { name: "There's already a recurring template with that name." } };
  console.error(e);
  return { ok: false, error: "Something went wrong saving that. Try again." };
}

function audit(companyId: string, userId: string, id: string, action: string, after?: unknown) {
  return query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'recurring_template', $3, $4, $5)", [
    companyId,
    userId,
    id,
    action,
    after === undefined ? null : JSON.stringify(after),
  ]);
}

/** Create a template from a saved transaction, or change an existing template's schedule. */
export async function saveRecurringAction(companyId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireCompany(companyId, "standard");
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const v = p.data;
  const sched = { unit: v.intervalUnit, count: v.intervalCount, dayOfMonth: v.intervalUnit === "week" ? null : v.dayOfMonth };
  const next = firstOccurrence(v.nextDate, sched);
  const end = v.endDate || null;
  try {
    let id: string;
    if (v.id) {
      const row = await one<{ id: string }>(
        `update recurring_templates set name = $3, mode = $4, interval_unit = $5, interval_count = $6, day_of_month = $7, next_date = $8,
                end_date = $9, auto_send = $10 and txn_type = 'invoice', last_error = null, updated_at = now()
         where company_id = $1 and id = $2 returning id`,
        [companyId, v.id, v.name, v.mode, sched.unit, sched.count, sched.dayOfMonth, end && next > end ? null : next, end, v.autoSend],
      );
      if (!row) return { ok: false, error: "That recurring template no longer exists." };
      id = row.id;
    } else {
      const t = await templateFromTxn(null, companyId, v.txnId!);
      const row = await one<{ id: string }>(
        `insert into recurring_templates (company_id, name, txn_type, template, interval_unit, interval_count, day_of_month, start_date, end_date,
                next_date, mode, due_days, auto_send, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $10, $11, $12 and $3 = 'invoice', $13) returning id`,
        [companyId, v.name, t.type, JSON.stringify(t.template), sched.unit, sched.count, sched.dayOfMonth, next, end, v.mode, t.dueDays, v.autoSend, ctx.userId],
      );
      id = row!.id;
    }
    await audit(companyId, ctx.userId, id, v.id ? "update" : "create", { name: v.name, mode: v.mode, ...sched, next });
    revalidatePath(`/c/${companyId}/recurring`);
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}

/** Pause or resume. Resuming skips the dates missed while paused. */
export async function setRecurringActiveAction(companyId: string, id: string, active: boolean): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  const t = await one<TemplateRow>("select * from recurring_templates where company_id = $1 and id = $2", [companyId, id]);
  if (!t) return { ok: false, error: "That recurring template no longer exists." };
  let next = t.next_date;
  if (active && next) {
    const today = await companyToday(companyId);
    while (next && next < today) next = nextOccurrence(next, { unit: t.interval_unit, count: t.interval_count, dayOfMonth: t.day_of_month });
    if (t.end_date && next > t.end_date) next = null;
  }
  await query("update recurring_templates set active = $3, next_date = $4, updated_at = now() where id = $2 and company_id = $1", [companyId, id, active, next]);
  await audit(companyId, ctx.userId, id, "update", { active, next_date: next });
  revalidatePath(`/c/${companyId}/recurring`);
  return { ok: true, data: null };
}

/** Delete a template. Transactions it already created stay. */
export async function deleteRecurringAction(companyId: string, id: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  await query("delete from recurring_templates where company_id = $1 and id = $2", [companyId, id]);
  await audit(companyId, ctx.userId, id, "delete");
  revalidatePath(`/c/${companyId}/recurring`);
  return { ok: true, data: null };
}

/** Create a transaction from the template now, dated today. If it was due, the schedule moves on. */
export async function createRecurringNowAction(companyId: string, id: string): Promise<ActionResult<{ href: string }>> {
  const ctx = await requireCompany(companyId, "standard");
  const t = await one<TemplateRow>("select * from recurring_templates where company_id = $1 and id = $2", [companyId, id]);
  if (!t) return { ok: false, error: "That recurring template no longer exists." };
  const today = await companyToday(companyId);
  try {
    const txnId = await createOccurrence(t, today, ctx.userId);
    let next = t.next_date;
    while (next && next <= today) next = nextOccurrence(next, { unit: t.interval_unit, count: t.interval_count, dayOfMonth: t.day_of_month });
    if (next && t.end_date && next > t.end_date) next = null;
    await query("update recurring_templates set next_date = $2, last_run_at = now(), last_error = null where id = $1", [id, next]);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: { href: txnHref(companyId, t.txn_type, txnId) } };
  } catch (e) {
    return fail(e);
  }
}
