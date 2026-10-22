import "server-only";
import type { PoolClient } from "pg";
import { one, pool, query } from "@/db";
import { addDays } from "@/lib/dates";
import { invoiceEmailText, sendInvoiceEmail } from "@/lib/invoice-email";
import { mailConfigured } from "@/lib/mail";
import { saveTransaction, UserError, type TxnInput } from "@/lib/txn/save";
import { firstOccurrence, nextOccurrence, RECURRING_TYPES, type IntervalUnit } from "./schedule";

/** Build a recurring template (the save-pipeline input without dates, number or id) from a saved transaction. */
export async function templateFromTxn(db: PoolClient | null, companyId: string, txnId: string): Promise<{ type: string; template: TxnInput; dueDays: number | null }> {
  const t = await one<{
    type: string;
    contact_id: string | null;
    account_id: string | null;
    terms_id: string | null;
    payment_method: string | null;
    memo: string | null;
    private_note: string | null;
    discount_cents: number;
    tax_rate_id: string | null;
    email_to: string[] | null;
    location_id: string | null;
    txn_date: string;
    due_date: string | null;
    total_cents: number;
    status: string;
  }>(
    `select type, contact_id, account_id, terms_id, payment_method, memo, private_note, discount_cents, tax_rate_id, email_to::text[] as email_to,
            location_id, txn_date, due_date, total_cents, status
     from transactions where company_id = $1 and id = $2`,
    [companyId, txnId],
    db ?? undefined,
  );
  if (!t) throw new UserError("That transaction no longer exists.");
  if (!(RECURRING_TYPES as readonly string[]).includes(t.type)) throw new UserError("This kind of transaction can't repeat.");
  const lines = await query<{ item_id: string | null; account_id: string | null; description: string | null; qty: number | null; rate_cents: number | null; amount_cents: number; taxable: boolean; kind: string; contact_id: string | null; class_id: string | null; billable: boolean }>(
    "select item_id, account_id, description, qty, rate_cents, amount_cents, taxable, kind, contact_id, class_id, billable from transaction_lines where transaction_id = $1 order by position",
    [txnId],
    db ?? undefined,
  );
  const tags = (await query<{ tag_id: string }>("select tag_id from transaction_tags where transaction_id = $1", [txnId], db ?? undefined)).map((r) => r.tag_id);
  const base: TxnInput = {
    type: t.type as TxnInput["type"],
    txnDate: "2000-01-01", // replaced on every run
    contactId: t.contact_id,
    termsId: t.terms_id,
    paymentMethod: t.payment_method,
    memo: t.memo,
    privateNote: t.private_note,
    discountCents: t.discount_cents,
    taxRateId: t.tax_rate_id,
    emailTo: t.email_to ?? [],
    locationId: t.location_id,
    tagIds: tags,
    lines: lines.map((l) => ({
      itemId: l.item_id,
      accountId: l.item_id ? null : l.account_id,
      description: l.description,
      qty: l.qty,
      rateCents: l.rate_cents,
      amountCents: l.amount_cents,
      taxable: l.taxable,
      side: l.kind === "debit" || l.kind === "credit" ? (l.kind as "debit" | "credit") : null,
      contactId: l.contact_id,
      classId: l.class_id,
      billable: l.billable,
    })),
  };
  if (["expense", "check", "sales_receipt"].includes(t.type)) base.accountId = t.account_id;
  if (t.type === "transfer") {
    const from = await one<{ account_id: string }>("select account_id from ledger_entries where transaction_id = $1 and credit_cents > 0 limit 1", [txnId], db ?? undefined);
    base.accountId = t.account_id;
    base.fromAccountId = from?.account_id ?? null;
    base.amountCents = t.total_cents;
    base.lines = [];
  }
  const dueDays = t.due_date ? Math.round((Date.parse(t.due_date) - Date.parse(t.txn_date)) / 86400000) : null;
  return { type: t.type, template: base, dueDays };
}

export interface TemplateRow {
  id: string;
  company_id: string;
  name: string;
  txn_type: string;
  template: TxnInput;
  interval_unit: IntervalUnit;
  interval_count: number;
  day_of_month: number | null;
  start_date: string;
  end_date: string | null;
  next_date: string | null;
  mode: "scheduled" | "reminder";
  due_days: number | null;
  auto_send: boolean;
  active: boolean;
  created_by: string | null;
}

/** Create one occurrence of a template, dated `date`. Returns the new transaction id. */
export async function createOccurrence(t: TemplateRow, date: string, userId: string | null) {
  const input: TxnInput = {
    ...t.template,
    type: t.txn_type as TxnInput["type"],
    id: undefined,
    number: null,
    txnDate: date,
    dueDate: t.due_days != null && (t.txn_type === "invoice" || t.txn_type === "bill") ? addDays(date, t.due_days) : null,
    source: "recurring",
    recurringTemplateId: t.id,
  };
  // the template's owner is who the change is attributed to in the audit log
  const owner = userId ?? t.created_by ?? (await one<{ user_id: string }>("select user_id from memberships where company_id = $1 and role = 'owner' and user_id is not null limit 1", [t.company_id]))!.user_id;
  const saved = await saveTransaction(t.company_id, owner, input);
  if (t.txn_type === "invoice" && t.auto_send && mailConfigured()) {
    const to = (t.template.emailTo ?? []).filter(Boolean);
    if (to.length) {
      const text = await invoiceEmailText(t.company_id, saved.id);
      await sendInvoiceEmail(t.company_id, null, saved.id, { to, ...text }, "recurring_invoice").catch((e) => console.error("recurring email failed", e));
    }
  }
  return saved.id;
}

export function scheduleOf(t: Pick<TemplateRow, "interval_unit" | "interval_count" | "day_of_month">) {
  return { unit: t.interval_unit, count: t.interval_count, dayOfMonth: t.day_of_month };
}

/** Create everything that's due (scheduled templates only). Catches up on missed runs, up to 24 per template. */
export async function runDueRecurring(): Promise<{ created: number; failed: number }> {
  const due = await query<TemplateRow & { today: string }>(
    `select r.*, (now() at time zone c.timezone)::date::text as today
     from recurring_templates r join companies c on c.id = r.company_id
     where r.active and r.mode = 'scheduled' and r.next_date is not null and r.next_date <= (now() at time zone c.timezone)::date`,
  );
  let created = 0;
  let failed = 0;
  for (const t of due) {
    let next: string | null = t.next_date;
    for (let n = 0; next && next <= t.today && n < 24; n++) {
      if (t.end_date && next > t.end_date) {
        next = null;
        break;
      }
      try {
        await createOccurrence(t, next, null);
        created++;
        await query("update recurring_templates set last_run_at = now(), last_error = null where id = $1", [t.id]);
      } catch (e) {
        failed++;
        await query("update recurring_templates set last_error = $2 where id = $1", [t.id, e instanceof Error ? e.message.slice(0, 500) : "failed"]);
        break; // try again next time, from the same date
      }
      next = nextOccurrence(next, scheduleOf(t));
      if (t.end_date && next > t.end_date) next = null;
      await query("update recurring_templates set next_date = $2 where id = $1", [t.id, next]);
    }
  }
  return { created, failed };
}

export { firstOccurrence, RECURRING_TYPES };

// ------------------------------------------------------------------ overdue reminders

export interface ReminderSettings {
  enabled: boolean;
  /** days after the due date, e.g. [3, 14, 30] */
  days: number[];
}

/** Email customers about overdue invoices, once per step in the company's reminder schedule. */
export async function runOverdueReminders(): Promise<number> {
  if (!mailConfigured()) return 0;
  const rows = await query<{ id: string; company_id: string; days_late: number; sent: number; steps: number[]; to: string[] }>(
    `select t.id, t.company_id, ((now() at time zone c.timezone)::date - t.due_date) as days_late,
            (select count(*) from reminders_sent r where r.transaction_id = t.id and r.kind = 'overdue')::int as sent,
            array(select jsonb_array_elements_text(c.invoice_defaults->'reminders'->'days')::int order by 1) as steps,
            coalesce(nullif(t.email_to::text[], '{}'), ct.emails::text[]) as to
     from transactions t join companies c on c.id = t.company_id join contacts ct on ct.id = t.contact_id
     where t.type = 'invoice' and t.status = 'posted' and t.balance_cents > 0 and t.due_date is not null
       and (c.invoice_defaults->'reminders'->>'enabled')::boolean is true
       and t.due_date < (now() at time zone c.timezone)::date`,
  );
  let sent = 0;
  for (const r of rows) {
    const reached = r.steps.filter((d) => r.days_late >= d).length;
    if (reached <= r.sent || !r.to?.length) continue;
    try {
      const text = await invoiceEmailText(r.company_id, r.id, true);
      await sendInvoiceEmail(r.company_id, null, r.id, { to: r.to, ...text }, "overdue");
      sent++;
    } catch (e) {
      console.error("reminder failed", r.id, e);
    }
  }
  return sent;
}

// ------------------------------------------------------------------ the job loop

/** Run all background jobs, on one server at a time (Postgres advisory lock). */
export async function runJobs() {
  const client = await pool.connect();
  try {
    const got = await client.query<{ ok: boolean }>("select pg_try_advisory_lock(424242) as ok");
    if (!got.rows[0].ok) return null;
    try {
      const recurring = await runDueRecurring();
      const reminders = await runOverdueReminders();
      return { ...recurring, reminders };
    } finally {
      await client.query("select pg_advisory_unlock(424242)");
    }
  } finally {
    client.release();
  }
}
