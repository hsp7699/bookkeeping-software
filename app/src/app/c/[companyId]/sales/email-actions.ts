"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { mailConfigured, sendMail } from "@/lib/mail";
import { loadPdfDoc, renderSalesPdf } from "@/lib/pdf/load";
import type { ActionResult } from "../actions";

const schema = z.object({
  to: z.array(z.string().trim().email("Enter valid email addresses.")).min(1, "Add at least one recipient."),
  subject: z.string().trim().min(1, "Add a subject.").max(200),
  body: z.string().max(10000),
});

export async function sendInvoiceAction(companyId: string, invoiceId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!mailConfigured()) {
    return { ok: false, error: "Email isn't set up yet. Add SMTP_URL and MAIL_FROM to the server's .env file, then try again. You can download the PDF meanwhile." };
  }
  const doc = await loadPdfDoc(companyId, invoiceId, "invoice");
  if (!doc) return { ok: false, error: "This invoice no longer exists." };
  if (doc.voided) return { ok: false, error: "A voided invoice can't be sent." };
  const company = await one<{ email: string | null }>("select email from companies where id = $1", [companyId]);
  try {
    await sendMail({
      to: parsed.data.to,
      replyTo: company?.email,
      subject: parsed.data.subject,
      text: parsed.data.body,
      attachments: [{ filename: `Invoice-${doc.number ?? "draft"}.pdf`, content: await renderSalesPdf(doc) }],
    });
  } catch (e) {
    console.error(e);
    return { ok: false, error: "The email server didn't accept the message. Check the SMTP settings and the address, then try again." };
  }
  await query("update transactions set emailed_at = now(), email_to = $3 where company_id = $1 and id = $2", [companyId, invoiceId, parsed.data.to]);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'transaction', $3, 'update', $4)", [
    companyId,
    ctx.userId,
    invoiceId,
    JSON.stringify({ type: "invoice", number: doc.number, emailed_to: parsed.data.to }),
  ]);
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: null };
}
