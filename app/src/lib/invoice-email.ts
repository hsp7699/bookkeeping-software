import "server-only";
import { one, query } from "@/db";
import { mailConfigured, sendMail } from "@/lib/mail";
import { loadPdfDoc, renderSalesPdf } from "@/lib/pdf/load";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export class MailNotConfigured extends Error {}

/** Email an invoice PDF and record it. Used by the Email button, recurring invoices and reminders. */
export async function sendInvoiceEmail(
  companyId: string,
  userId: string | null,
  invoiceId: string,
  msg: { to: string[]; subject: string; body: string },
  kind: "manual" | "recurring_invoice" | "overdue" = "manual",
) {
  if (!mailConfigured()) throw new MailNotConfigured();
  const doc = await loadPdfDoc(companyId, invoiceId, "invoice");
  if (!doc) throw new Error("invoice not found");
  const company = await one<{ email: string | null }>("select email from companies where id = $1", [companyId]);
  await sendMail({
    to: msg.to,
    replyTo: company?.email,
    subject: msg.subject,
    text: msg.body,
    attachments: [{ filename: `Invoice-${doc.number ?? "draft"}.pdf`, content: await renderSalesPdf(doc) }],
  });
  await query("update transactions set emailed_at = now(), email_to = $3 where company_id = $1 and id = $2", [companyId, invoiceId, msg.to]);
  if (kind !== "manual") {
    await query("insert into reminders_sent (company_id, transaction_id, kind, sent_to) values ($1, $2, $3, $4)", [companyId, invoiceId, kind, msg.to]);
  }
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'transaction', $3, 'update', $4)", [
    companyId,
    userId,
    invoiceId,
    JSON.stringify({ type: "invoice", number: doc.number, emailed_to: msg.to, reason: kind }),
  ]);
  return doc;
}

/** Default wording for an invoice email. */
export async function invoiceEmailText(companyId: string, invoiceId: string, overdue = false) {
  const r = await one<{ number: string | null; balance_cents: number; due_date: string | null; company: string; customer: string }>(
    `select t.number, t.balance_cents, t.due_date, co.name as company, c.display_name as customer
     from transactions t join companies co on co.id = t.company_id join contacts c on c.id = t.contact_id where t.id = $1 and t.company_id = $2`,
    [invoiceId, companyId],
  );
  if (!r) return { subject: "Invoice", body: "" };
  if (overdue) {
    return {
      subject: `Reminder: invoice ${r.number ?? ""} from ${r.company} is past due`,
      body: `Hello ${r.customer},\n\nThis is a friendly reminder that invoice ${r.number ?? ""} for ${formatCents(r.balance_cents)} was due ${r.due_date ? formatDate(r.due_date) : ""}. A copy is attached.\n\nIf you've already paid, thank you, and please ignore this.\n\n${r.company}\n`,
    };
  }
  return {
    subject: `Invoice ${r.number ?? ""} from ${r.company}`,
    body: `Hello ${r.customer},\n\nYour invoice ${r.number ?? ""} for ${formatCents(r.balance_cents)} is attached${r.due_date ? `, due ${formatDate(r.due_date)}` : ""}.\n\nThank you for your business.\n${r.company}\n`,
  };
}
