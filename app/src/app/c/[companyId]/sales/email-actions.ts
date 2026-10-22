"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one } from "@/db";
import { requireCompany } from "@/lib/authz";
import { sendInvoiceEmail } from "@/lib/invoice-email";
import { mailConfigured } from "@/lib/mail";
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
  const inv = await one<{ status: string }>("select status from transactions where company_id = $1 and id = $2 and type = 'invoice'", [companyId, invoiceId]);
  if (!inv) return { ok: false, error: "This invoice no longer exists." };
  if (inv.status === "voided") return { ok: false, error: "A voided invoice can't be sent." };
  try {
    await sendInvoiceEmail(companyId, ctx.userId, invoiceId, parsed.data);
  } catch (e) {
    console.error(e);
    return { ok: false, error: "The email server didn't accept the message. Check the SMTP settings and the address, then try again." };
  }
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: null };
}
