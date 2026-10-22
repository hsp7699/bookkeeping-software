import "server-only";
import nodemailer from "nodemailer";

// Sends through your own SMTP provider. Set SMTP_URL (smtp://user:pass@host:587)
// and MAIL_FROM ("Harbor Studio <billing@yourdomain.com>") in .env.

export function mailConfigured() {
  return !!process.env.SMTP_URL && !!process.env.MAIL_FROM;
}

export async function sendMail(msg: { to: string[]; replyTo?: string | null; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }) {
  if (!mailConfigured()) throw new Error("MAIL_NOT_CONFIGURED");
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to: msg.to,
    replyTo: msg.replyTo ?? undefined,
    subject: msg.subject,
    text: msg.text,
    attachments: msg.attachments,
  });
}
