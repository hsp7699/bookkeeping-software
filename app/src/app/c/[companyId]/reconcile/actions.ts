"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tx } from "@/db";
import { requireCompany } from "@/lib/authz";
import { discard, editStatement, finish, startReconciliation, tick, undoLast } from "@/lib/reconcile";
import { UserError } from "@/lib/txn/save";
import type { ActionResult } from "../actions";

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UserError) return { ok: false, error: e.message };
  const pg = e as { code?: string; message?: string };
  if (pg.code === "23514" && pg.message?.includes("closed period")) return { ok: false, error: "The adjustment would fall in a closed period. Reopen the books first." };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

const startSchema = z.object({
  accountId: z.string().uuid(),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the statement ending date."),
  endingCents: z.number().int(),
});

export async function startAction(companyId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  await requireCompany(companyId, "standard");
  const p = startSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  try {
    const id = await tx((db) => startReconciliation(db, companyId, p.data.accountId, p.data.statementDate, p.data.endingCents));
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}

export async function tickAction(companyId: string, reconId: string, entryIds: string[], on: boolean): Promise<ActionResult<null>> {
  await requireCompany(companyId, "standard");
  try {
    await tx((db) => tick(db, companyId, reconId, entryIds, on));
    revalidatePath(`/c/${companyId}/reconcile/${reconId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function editStatementAction(companyId: string, reconId: string, statementDate: string, endingCents: number): Promise<ActionResult<null>> {
  await requireCompany(companyId, "standard");
  try {
    await tx((db) => editStatement(db, companyId, reconId, statementDate, endingCents));
    revalidatePath(`/c/${companyId}/reconcile/${reconId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function finishAction(companyId: string, reconId: string, allowAdjustment: boolean): Promise<ActionResult<{ adjustmentCents: number }>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    const r = await tx((db) => finish(db, companyId, ctx.userId, reconId, allowAdjustment));
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

export async function undoAction(companyId: string, reconId: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "accountant");
  try {
    await tx((db) => undoLast(db, companyId, ctx.userId, reconId));
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function discardAction(companyId: string, reconId: string): Promise<ActionResult<null>> {
  await requireCompany(companyId, "standard");
  try {
    await tx((db) => discard(db, companyId, reconId));
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
