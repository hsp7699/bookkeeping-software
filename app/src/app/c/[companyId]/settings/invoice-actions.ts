"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import type { ActionResult } from "../actions";

/** WCAG contrast of a hex colour against white paper. */
function contrastOnWhite(hex: string) {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return 1.05 / (l + 0.05);
}

const appearance = z.object({
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.")
    .refine((c) => contrastOnWhite(c) >= 4.5, "That colour is too light to read on white paper. Pick a darker one."),
  footer: z.string().trim().max(300, "Keep the footer under 300 characters."),
  showQtyRate: z.boolean(),
  logoAttachmentId: z.string().uuid().nullable(),
});

const reminders = z.object({
  enabled: z.boolean(),
  days: z
    .array(z.coerce.number().int().min(1, "Use days after the due date, 1 or more.").max(365, "365 days at most."))
    .max(5, "Up to 5 reminders.")
    .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
});

async function merge(companyId: string, userId: string, patch: Record<string, unknown>) {
  await query("update companies set invoice_defaults = invoice_defaults || $2::jsonb, updated_at = now() where id = $1", [companyId, JSON.stringify(patch)]);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'company', $1, 'update', $3)", [
    companyId,
    userId,
    JSON.stringify({ invoiceDefaults: patch }),
  ]);
  revalidatePath(`/c/${companyId}/settings`);
}

export async function saveInvoiceAppearanceAction(companyId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "admin");
  const p = appearance.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.logoAttachmentId) {
    const a = await one<{ content_type: string }>("select content_type from attachments where company_id = $1 and id = $2", [companyId, p.data.logoAttachmentId]);
    if (!a || !["image/png", "image/jpeg"].includes(a.content_type)) return { ok: false, error: "Use a PNG or JPEG for the logo." };
  }
  await merge(companyId, ctx.userId, { ...p.data, footer: p.data.footer || null });
  return { ok: true, data: null };
}

export async function saveRemindersAction(companyId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "admin");
  const p = reminders.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.enabled && p.data.days.length === 0) return { ok: false, error: "Add at least one reminder." };
  await merge(companyId, ctx.userId, { reminders: p.data });
  return { ok: true, data: null };
}
