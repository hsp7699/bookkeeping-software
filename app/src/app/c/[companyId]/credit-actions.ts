"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/authz";
import { applyCredit, listCredits, unapplyCredit } from "@/lib/txn/credits";
import { UserError } from "@/lib/txn/save";
import type { ActionResult } from "./actions";

export async function listCreditsAction(companyId: string, contactId: string, side: "ar" | "ap") {
  await requireCompany(companyId);
  return listCredits(companyId, contactId, side);
}

export async function applyCreditAction(companyId: string, sourceId: string, targetId: string, amountCents: number): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    await applyCredit(companyId, ctx.userId, sourceId, targetId, amountCents);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong applying that credit." };
  }
}

export async function unapplyCreditAction(companyId: string, sourceId: string, targetId: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    await unapplyCredit(companyId, ctx.userId, sourceId, targetId);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
