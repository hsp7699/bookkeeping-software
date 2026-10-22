"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { BALANCE_SHEET_TYPES, DETAIL_TYPES, type AccountType } from "@/lib/coa";
import { deleteTransaction, saveTransaction, UserError } from "@/lib/txn/save";
import type { ActionResult } from "../actions";

const TYPES = Object.keys(DETAIL_TYPES) as [AccountType, ...AccountType[]];

const accountSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(100),
  number: z.string().trim().max(20).optional(),
  type: z.enum(TYPES),
  detailType: z.string().min(1),
  parentId: z.union([z.literal(""), z.string().uuid()]).optional(),
  description: z.string().max(1000).optional(),
  openingBalanceCents: z.number().int().nullable().optional(),
  openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function saveAccountAction(companyId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireCompany(companyId, "standard");
  const parsed = accountSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const a = parsed.data;
  const err = (field: string, msg: string): ActionResult<never> => ({ ok: false, error: "Check the highlighted fields.", fieldErrors: { [field]: msg } });
  if (!DETAIL_TYPES[a.type].includes(a.detailType)) return err("detailType", "Pick a detail type for this account type.");

  try {
    if (a.parentId) {
      const parent = await one<{ type: string; parent_id: string | null }>("select type, parent_id from accounts where company_id = $1 and id = $2", [companyId, a.parentId]);
      if (!parent) return err("parentId", "That parent account no longer exists.");
      if (parent.type !== a.type) return err("parentId", "A sub-account must have the same type as its parent.");
      if (a.id && a.parentId === a.id) return err("parentId", "An account can't be its own parent.");
    }
    if (a.id) {
      const existing = await one<{ type: string; system_role: string | null }>("select type, system_role from accounts where company_id = $1 and id = $2", [companyId, a.id]);
      if (!existing) return { ok: false, error: "This account no longer exists." };
      if (existing.system_role && existing.type !== a.type) return err("type", "This account is used by the books automatically, so its type can't change.");
      if (existing.type !== a.type) {
        const used = await one("select 1 from ledger_entries where account_id = $1 limit 1", [a.id]);
        const crossesSheet = BALANCE_SHEET_TYPES.has(existing.type as AccountType) !== BALANCE_SHEET_TYPES.has(a.type);
        if (used && crossesSheet) return err("type", "This account has transactions, so it can't move between the balance sheet and profit and loss.");
        if (["accounts_receivable", "accounts_payable"].includes(existing.type) || ["accounts_receivable", "accounts_payable"].includes(a.type)) {
          if (used) return err("type", "A/R and A/P accounts with transactions can't change type.");
        }
      }
      await query(
        `update accounts set name = $3, number = $4, type = $5, detail_type = $6, parent_id = $7, description = $8 where company_id = $1 and id = $2`,
        [companyId, a.id, a.name, a.number || null, a.type, a.detailType, a.parentId || null, a.description || null],
      );
      await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'account', $3, 'update', $4)", [companyId, ctx.userId, a.id, JSON.stringify(a)]);
      revalidatePath(`/c/${companyId}`, "layout");
      return { ok: true, data: { id: a.id } };
    }

    const row = await one<{ id: string }>(
      `insert into accounts (company_id, name, number, type, detail_type, parent_id, description) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [companyId, a.name, a.number || null, a.type, a.detailType, a.parentId || null, a.description || null],
    );
    await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'account', $3, 'create', $4)", [companyId, ctx.userId, row!.id, JSON.stringify(a)]);
    if (a.openingBalanceCents && BALANCE_SHEET_TYPES.has(a.type)) {
      // Opening balances are entered as shown on the statement: positive. Liabilities and equity are credit balances.
      const debitNormal = ["bank", "accounts_receivable", "other_current_asset", "fixed_asset", "other_asset"].includes(a.type);
      await saveTransaction(companyId, ctx.userId, {
        type: "opening_balance",
        txnDate: a.openingBalanceDate!,
        accountId: row!.id,
        amountCents: debitNormal ? a.openingBalanceCents : -a.openingBalanceCents,
        memo: "Opening balance",
      });
    }
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: { id: row!.id } };
  } catch (e) {
    const pg = e as { code?: string };
    if (pg.code === "23505") return err("name", "An account with this name or number already exists.");
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong saving that account." };
  }
}

export async function setAccountActiveAction(companyId: string, id: string, active: boolean): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  const a = await one<{ system_role: string | null; type: string; balance: number; children: number }>(
    `select a.system_role, a.type,
       coalesce((select sum(debit_cents - credit_cents) from ledger_entries e where e.account_id = a.id), 0)::bigint as balance,
       (select count(*) from accounts c where c.parent_id = a.id and c.active)::int as children
     from accounts a where a.company_id = $1 and a.id = $2`,
    [companyId, id],
  );
  if (!a) return { ok: false, error: "This account no longer exists." };
  if (!active) {
    if (a.system_role) return { ok: false, error: "The books use this account automatically, so it can't be made inactive." };
    if (a.children > 0) return { ok: false, error: "Make its sub-accounts inactive first." };
    if (BALANCE_SHEET_TYPES.has(a.type as AccountType) && a.balance !== 0) {
      return { ok: false, error: "This account still has a balance. Move the balance to another account first, with a transfer or journal entry." };
    }
  }
  await query("update accounts set active = $3 where company_id = $1 and id = $2", [companyId, id, active]);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'account', $3, 'update', $4)", [companyId, ctx.userId, id, JSON.stringify({ active })]);
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: null };
}

export async function deleteTransactionAction(companyId: string, id: string, closePassword?: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    const closeOverride = closePassword ? await checkClosePassword(companyId, closePassword) : false;
    await deleteTransaction(companyId, ctx.userId, id, { closeOverride });
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong deleting that." };
  }
}

async function checkClosePassword(companyId: string, password: string): Promise<boolean> {
  const { verify } = await import("@node-rs/argon2");
  const c = await one<{ close_password_hash: string | null }>("select close_password_hash from companies where id = $1", [companyId]);
  if (!c?.close_password_hash || !(await verify(c.close_password_hash, password))) throw new UserError("That close-books password isn't right.");
  return true;
}
