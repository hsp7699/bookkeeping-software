"use server";

import { z } from "zod";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { mailConfigured, sendMail } from "@/lib/mail";
import { renderStatementPdf } from "@/lib/pdf/load";
import { loadStatement } from "@/lib/statements";
import type { ActionResult } from "../../../actions";

const schema = z.object({
  kind: z.enum(["balance_forward", "open_item"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_emails: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses.")).min(1, "Add an email address.").max(10),
  subject: z.string().trim().min(1, "Add a subject.").max(200),
  body: z.string().max(5000),
});

export async function emailStatementAction(companyId: string, customerId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  if (!mailConfigured()) return { ok: false, error: "Email isn't set up on this server yet. Add SMTP_URL and MAIL_FROM to the server's .env, or download the PDF and send it yourself." };
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const st = await loadStatement(companyId, customerId, p.data.kind, p.data.from, p.data.to);
  if (!st) return { ok: false, error: "That customer no longer exists." };
  try {
    await sendMail({
      to: p.data.to_emails,
      replyTo: st.company.email,
      subject: p.data.subject,
      text: p.data.body,
      attachments: [{ filename: `Statement-${p.data.to}.pdf`, content: await renderStatementPdf(companyId, st) }],
    });
  } catch (e) {
    console.error("statement email failed", e);
    return { ok: false, error: "The mail server didn't accept the message. Check the SMTP settings and try again." };
  }
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'contact', $3, 'update', $4)", [
    companyId,
    ctx.userId,
    customerId,
    JSON.stringify({ statement_sent: true, kind: p.data.kind, from: p.data.from, to: p.data.to, emailed_to: p.data.to_emails, amount_due: st.closingCents }),
  ]);
  return { ok: true, data: null };
}

/** Default wording, built on the server so it matches the PDF's numbers. */
export async function statementEmailText(companyId: string, customerId: string, kind: "balance_forward" | "open_item", from: string, to: string) {
  await requireCompany(companyId);
  const st = await loadStatement(companyId, customerId, kind, from, to);
  if (!st) return { subject: "", body: "" };
  return {
    subject: `Statement from ${st.company.name}`,
    body: `Hello ${st.customer.name},\n\nYour statement as of ${formatDate(to)} is attached. The amount due is ${formatCents(st.closingCents)}.\n\nThank you for your business.\n${st.company.name}\n`,
  };
}
