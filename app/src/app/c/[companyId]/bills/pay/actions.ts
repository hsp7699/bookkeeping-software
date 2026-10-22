"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tx } from "@/db";
import { requireCompany } from "@/lib/authz";
import { PostingError } from "@/lib/posting";
import { saveInDb, txnInput, UserError } from "@/lib/txn/save";
import type { ActionResult } from "../../actions";

const schema = z.object({
  accountId: z.string().uuid("Choose the account to pay from."),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkNumber: z.string().max(21).optional(),
  payments: z.array(z.object({ billId: z.string().uuid(), vendorId: z.string().uuid(), amountCents: z.number().int().positive() })).min(1, "Choose at least one bill to pay."),
});

/** Pay several bills at once: one bill payment per vendor, all or nothing. */
export async function payBillsAction(companyId: string, raw: unknown): Promise<ActionResult<{ count: number }>> {
  const ctx = await requireCompany(companyId, "standard");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { accountId, txnDate, checkNumber, payments } = parsed.data;
  const byVendor = new Map<string, typeof payments>();
  for (const p of payments) byVendor.set(p.vendorId, [...(byVendor.get(p.vendorId) ?? []), p]);
  try {
    await tx(async (db) => {
      let n = checkNumber ? Number(checkNumber) : NaN;
      for (const [vendorId, list] of byVendor) {
        const input = txnInput.parse({
          type: "bill_payment",
          contactId: vendorId,
          txnDate,
          accountId,
          amountCents: list.reduce((s, p) => s + p.amountCents, 0),
          number: checkNumber ? (Number.isFinite(n) ? String(n++) : checkNumber) : null,
          applications: list.map((p) => ({ txnId: p.billId, amountCents: p.amountCents })),
        });
        await saveInDb(db, companyId, ctx.userId, input);
      }
    });
  } catch (e) {
    if (e instanceof UserError || e instanceof PostingError) return { ok: false, error: e.message };
    const pg = e as { code?: string; message?: string };
    if (pg.code === "23514" && pg.message?.includes("closed period")) return { ok: false, error: "That payment date is in a closed period." };
    console.error(e);
    return { ok: false, error: "Something went wrong paying those bills." };
  }
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: { count: byVendor.size } };
}
