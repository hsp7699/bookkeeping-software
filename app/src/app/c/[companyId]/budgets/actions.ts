"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query, tx } from "@/db";
import { requireCompany } from "@/lib/authz";
import { actualsForFiscalYear, saveBudgetLines } from "@/lib/budgets";
import type { ActionResult } from "../actions";

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the budget a name.").max(100),
  fiscalYear: z.coerce.number().int().min(2000).max(2200),
  startFrom: z.enum(["blank", "last_year"]),
});

function audit(companyId: string, userId: string, id: string, action: string, after?: unknown) {
  return query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'budget', $3, $4, $5)", [
    companyId,
    userId,
    id,
    action,
    after === undefined ? null : JSON.stringify(after),
  ]);
}

export async function createBudgetAction(companyId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireCompany(companyId, "standard");
  const p = createSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  try {
    const id = await tx(async (db) => {
      const row = await one<{ id: string }>("insert into budgets (company_id, name, fiscal_year) values ($1, $2, $3) returning id", [companyId, p.data.name, p.data.fiscalYear], db);
      if (p.data.startFrom === "last_year") {
        const c = await one<{ fy: number; basis: "accrual" | "cash" }>("select fiscal_year_start_month as fy, accounting_method as basis from companies where id = $1", [companyId], db);
        const actuals = await actualsForFiscalYear(companyId, p.data.fiscalYear - 1, c!.fy, c!.basis);
        await saveBudgetLines(db, row!.id, [...actuals].map(([accountId, periods]) => ({ accountId, periods })));
      }
      return row!.id;
    });
    await audit(companyId, ctx.userId, id, "create", p.data);
    revalidatePath(`/c/${companyId}/budgets`);
    return { ok: true, data: { id } };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, error: "There's already a budget with that name." };
    throw e;
  }
}

const saveSchema = z.object({
  name: z.string().trim().min(1, "Give the budget a name.").max(100),
  rows: z.array(z.object({ accountId: z.string().uuid(), periods: z.array(z.number().int().min(-1e13).max(1e13)).length(12) })).max(2000),
});

export async function saveBudgetAction(companyId: string, budgetId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  const p = saveSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const exists = await one("select 1 from budgets where company_id = $1 and id = $2", [companyId, budgetId]);
  if (!exists) return { ok: false, error: "That budget no longer exists." };
  // every account must be one of this company's P&L accounts
  const ids = [...new Set(p.data.rows.map((r) => r.accountId))];
  const ok = await one<{ n: number }>(
    "select count(*)::int as n from accounts where company_id = $1 and id = any($2::uuid[]) and type in ('income','cost_of_goods_sold','expense','other_income','other_expense')",
    [companyId, ids],
  );
  if (ok!.n !== ids.length) return { ok: false, error: "Budgets can only include income and expense accounts." };
  try {
    await tx(async (db) => {
      await query("update budgets set name = $3 where company_id = $1 and id = $2", [companyId, budgetId, p.data.name], db);
      await saveBudgetLines(db, budgetId, p.data.rows);
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, error: "There's already a budget with that name." };
    throw e;
  }
  const total = p.data.rows.reduce((s, r) => s + r.periods.reduce((a, b) => a + b, 0), 0);
  await audit(companyId, ctx.userId, budgetId, "update", { name: p.data.name, accounts: p.data.rows.filter((r) => r.periods.some(Boolean)).length, total_cents: total });
  revalidatePath(`/c/${companyId}/budgets`);
  return { ok: true, data: null };
}

export async function deleteBudgetAction(companyId: string, budgetId: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  await query("delete from budgets where company_id = $1 and id = $2", [companyId, budgetId]);
  await audit(companyId, ctx.userId, budgetId, "delete");
  revalidatePath(`/c/${companyId}/budgets`);
  return { ok: true, data: null };
}
