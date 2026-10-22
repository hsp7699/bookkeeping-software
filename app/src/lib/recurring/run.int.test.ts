import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one, pool, query, tx } from "@/db";
import { addDays } from "@/lib/dates";
import { createCompany } from "@/lib/company";
import { saveTransaction } from "@/lib/txn/save";
import { runDueRecurring, templateFromTxn } from "./run";
import { nextOccurrence } from "./schedule";

const d = process.env.DATABASE_URL ? describe : describe.skip;
let companyId = "";
let userId = "";
let today = "";
const acct: Record<string, string> = {};
let customer = "";

async function addTemplate(fromTxn: string, name: string, next: string, opts: { end?: string; mode?: string; dayOfMonth?: number | null } = {}) {
  const t = await templateFromTxn(null, companyId, fromTxn);
  return (await one<{ id: string }>(
    `insert into recurring_templates (company_id, name, txn_type, template, interval_unit, interval_count, day_of_month, start_date, end_date, next_date, mode, due_days, created_by)
     values ($1, $2, $3, $4, 'month', 1, $5, $6, $7, $6, $8, $9, $10) returning id`,
    [companyId, name, t.type, JSON.stringify(t.template), opts.dayOfMonth ?? null, next, opts.end ?? null, opts.mode ?? "scheduled", t.dueDays, userId],
  ))!.id;
}
const template = (id: string) => one<{ next_date: string | null; last_error: string | null }>("select next_date::text, last_error from recurring_templates where id = $1", [id]);
const created = (id: string) =>
  query<{ txn_date: string; due_date: string | null; total_cents: number; source: string; contact_id: string; number: string }>(
    "select txn_date::text, due_date::text, total_cents, source, contact_id, number from transactions where recurring_template_id = $1 order by txn_date",
    [id],
  );

d("recurring transactions (database)", () => {
  beforeAll(async () => {
    userId = (await one<{ id: string }>("insert into users (email) values ($1) returning id", [`recur+${Date.now()}@example.com`]))!.id;
    companyId = await tx((db) => createCompany(db, userId, { name: "Recur Co", entityType: "sole_prop", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
    for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
    customer = (await one<{ id: string }>("insert into contacts (company_id, kind, display_name) values ($1, 'customer', 'Retainer Client') returning id", [companyId]))!.id;
    today = (await one<{ d: string }>("select (now() at time zone timezone)::date::text as d from companies where id = $1", [companyId]))!.d;
  });
  afterAll(() => pool.end());

  it("catches up on missed months, copies the invoice, and sets due dates from the original terms", async () => {
    const src = await saveTransaction(companyId, userId, {
      type: "invoice",
      contactId: customer,
      txnDate: "2026-01-15",
      dueDate: "2026-02-14",
      memo: "Monthly retainer",
      lines: [{ accountId: acct["Services"], description: "Retainer", qty: 1, rateCents: 250000, amountCents: 250000 }],
    });
    const start = addDays(today, -65); // about two months ago
    const id = await addTemplate(src.id, "Retainer", start);

    const expected: string[] = [];
    for (let dte = start; dte <= today; dte = nextOccurrence(dte, { unit: "month", count: 1 })) expected.push(dte);

    await runDueRecurring();
    const rows = await created(id);
    expect(rows.map((r) => r.txn_date)).toEqual(expected);
    for (const r of rows) {
      expect(r.total_cents).toBe(250000);
      expect(r.contact_id).toBe(customer);
      expect(r.source).toBe("recurring");
      expect(r.due_date).toBe(addDays(r.txn_date, 30));
    }
    expect(new Set(rows.map((r) => r.number)).size).toBe(rows.length); // each got its own number
    const t = await template(id);
    expect(t!.next_date! > today).toBe(true);
    expect(t!.last_error).toBeNull();

    // running again creates nothing more
    await runDueRecurring();
    expect((await created(id)).length).toBe(expected.length);
  });

  it("stops at the end date", async () => {
    const src = await saveTransaction(companyId, userId, { type: "expense", txnDate: "2026-01-01", accountId: acct["Business Checking"], lines: [{ accountId: acct["Rent or Lease"] ?? acct["Rent & Lease"], amountCents: 120000 }] });
    const start = addDays(today, -40);
    const id = await addTemplate(src.id, "Rent", start, { end: addDays(start, 10) });
    await runDueRecurring();
    expect((await created(id)).map((r) => r.txn_date)).toEqual([start]);
    expect((await template(id))!.next_date).toBeNull();
  });

  it("leaves reminders alone", async () => {
    const src = await saveTransaction(companyId, userId, { type: "invoice", contactId: customer, txnDate: "2026-01-20", lines: [{ accountId: acct["Services"], amountCents: 5000 }] });
    const id = await addTemplate(src.id, "Reminder only", addDays(today, -3), { mode: "reminder" });
    await runDueRecurring();
    expect(await created(id)).toEqual([]);
  });

  it("records the error and retries from the same date when a run fails", async () => {
    const src = await saveTransaction(companyId, userId, { type: "invoice", contactId: customer, txnDate: "2026-01-20", lines: [{ accountId: acct["Services"], amountCents: 5000 }] });
    const start = addDays(today, -1);
    const id = await addTemplate(src.id, "Breaks", start);
    // the customer is gone: the save pipeline refuses it
    await query("update recurring_templates set template = jsonb_set(template, '{contactId}', to_jsonb(gen_random_uuid()::text)) where id = $1", [id]);
    const res = await runDueRecurring();
    expect(res.failed).toBeGreaterThanOrEqual(1);
    const t = await template(id);
    expect(t!.next_date).toBe(start);
    expect(t!.last_error).toBeTruthy();
  });
});
