import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { one, query, tx } from "@/db";
import { lineAmount } from "@/lib/money";
import { post, PostingError, type PostingLine, type SystemAccounts } from "@/lib/posting";

// Saves a transaction: validates, resolves item lines to accounts, posts
// ledger entries, keeps open balances right, numbers it, audits it. One
// database transaction; the balance trigger checks the ledger at commit.

export class UserError extends Error {}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");
const uuid = z.string().uuid();

const salesLine = z.object({
  itemId: uuid.nullish(),
  accountId: uuid.nullish(),
  description: z.string().max(4000).nullish(),
  qty: z.number().finite().nullish(),
  rateCents: z.number().finite().nullish(),
  amountCents: z.number().int(),
  taxable: z.boolean().default(false),
});

export const invoiceInput = z.object({
  type: z.literal("invoice"),
  id: uuid.optional(),
  ifUpdatedAt: z.string().optional(),
  contactId: uuid,
  txnDate: dateStr,
  dueDate: dateStr.nullish(),
  termsId: uuid.nullish(),
  number: z.string().trim().max(21).nullish(),
  lines: z.array(salesLine).min(1, "Add at least one line."),
  discountCents: z.number().int().min(0).default(0),
  taxRateId: uuid.nullish(),
  memo: z.string().max(4000).nullish(),
  privateNote: z.string().max(4000).nullish(),
  emailTo: z.array(z.string().email()).default([]),
});

export const paymentInput = z.object({
  type: z.literal("payment"),
  id: uuid.optional(),
  ifUpdatedAt: z.string().optional(),
  contactId: uuid,
  txnDate: dateStr,
  depositToId: uuid.nullish(), // null -> Undeposited Funds
  paymentMethod: z.string().max(40).nullish(),
  number: z.string().trim().max(21).nullish(), // reference no.
  amountCents: z.number().int().positive("Enter the amount received."),
  applications: z.array(z.object({ txnId: uuid, amountCents: z.number().int().positive() })).default([]),
  memo: z.string().max(4000).nullish(),
});

export const saveInput = z.discriminatedUnion("type", [invoiceInput, paymentInput]);
export type SaveInput = z.infer<typeof saveInput>;

async function systemAccounts(db: PoolClient, companyId: string): Promise<SystemAccounts> {
  const rows = await query<{ id: string; system_role: string }>(
    "select id, system_role from accounts where company_id = $1 and system_role is not null",
    [companyId],
    db,
  );
  const by = Object.fromEntries(rows.map((r) => [r.system_role, r.id]));
  const need = (role: string) => {
    if (!by[role]) throw new Error(`Company is missing its ${role} account`);
    return by[role];
  };
  return {
    accountsReceivable: need("accounts_receivable"),
    accountsPayable: need("accounts_payable"),
    undepositedFunds: need("undeposited_funds"),
    salesTaxPayable: need("sales_tax_payable"),
    discountsGiven: need("discounts_given"),
    openingBalanceEquity: need("opening_balance_equity"),
  };
}

async function nextNumber(db: PoolClient, companyId: string, type: string): Promise<string> {
  const row = await one<{ next_value: number }>(
    `insert into number_sequences (company_id, type) values ($1, $2)
     on conflict (company_id, type) do update set next_value = number_sequences.next_value
     returning next_value`,
    [companyId, type],
    db,
  );
  // lock and bump; skip numbers the user typed by hand
  let n = row!.next_value;
  for (;;) {
    const taken = await one("select 1 from transactions where company_id = $1 and type = $2 and number = $3", [companyId, type, String(n)], db);
    if (!taken) break;
    n++;
  }
  await query("update number_sequences set next_value = $3 where company_id = $1 and type = $2", [companyId, type, n + 1], db);
  return String(n);
}

/** Recompute the open balance of invoices/bills from their applications. */
async function refreshBalances(db: PoolClient, txnIds: string[]) {
  if (txnIds.length === 0) return;
  await query(
    `update transactions t set balance_cents = case when t.status = 'voided' then 0 else
        greatest(t.total_cents - coalesce((select sum(a.amount_cents) from payment_applications a where a.target_txn_id = t.id), 0), 0) end
     where t.id = any($1::uuid[])`,
    [txnIds],
    db,
  );
}

async function lockExisting(db: PoolClient, companyId: string, id: string, type: string, ifUpdatedAt?: string) {
  const row = await one<{ id: string; type: string; status: string; unchanged: boolean }>(
    `select id, type, status, ($3::text is null or updated_at = $3::timestamptz) as unchanged
     from transactions where company_id = $1 and id = $2 for update`,
    [companyId, id, ifUpdatedAt ?? null],
    db,
  );
  if (!row || row.type !== type) throw new UserError("This transaction no longer exists.");
  if (row.status === "voided") throw new UserError("A voided transaction can't be edited.");
  if (!row.unchanged) {
    throw new UserError("Someone else changed this transaction while you were editing. Reload to see their changes.");
  }
  return row;
}

async function writeEntries(
  db: PoolClient,
  companyId: string,
  txnId: string,
  date: string,
  entries: ReturnType<typeof post>["entries"],
  lineIds: (string | null)[],
) {
  // Replace unreconciled entries. Reconciled ones are protected by a trigger.
  await query("delete from ledger_entries where transaction_id = $1", [txnId], db);
  for (const e of entries) {
    const lineId = e.lineId != null ? lineIds[Number(e.lineId)] ?? null : null;
    await query(
      `insert into ledger_entries (company_id, transaction_id, line_id, account_id, entry_date, debit_cents, credit_cents, contact_id, memo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [companyId, txnId, lineId, e.accountId, date, e.debitCents, e.creditCents, e.contactId, e.memo],
      db,
    );
  }
}

async function audit(db: PoolClient, companyId: string, userId: string, id: string, action: string, before: unknown, after: unknown) {
  await query(
    `insert into audit_events (company_id, user_id, entity, entity_id, action, before, after) values ($1, $2, 'transaction', $3, $4, $5, $6)`,
    [companyId, userId, id, action, before ? JSON.stringify(before) : null, JSON.stringify(after)],
    db,
  );
}

async function snapshot(db: PoolClient, id: string) {
  return one(
    `select t.*, coalesce((select json_agg(l order by l.position) from transaction_lines l where l.transaction_id = t.id), '[]') as lines
     from transactions t where t.id = $1`,
    [id],
    db,
  );
}

export async function saveTransaction(companyId: string, userId: string, raw: unknown): Promise<{ id: string; number: string | null }> {
  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Check the form for errors.");
  const input = parsed.data;
  try {
    return await tx(async (db) => {
      const sys = await systemAccounts(db, companyId);
      const before = input.id ? await snapshot(db, input.id) : null;
      if (input.id) await lockExisting(db, companyId, input.id, input.type, input.ifUpdatedAt);
      const contact = await one<{ kind: string; active: boolean }>(
        "select kind, active from contacts where company_id = $1 and id = $2",
        [companyId, input.contactId],
        db,
      );
      if (!contact) throw new UserError("Choose a customer.");
      if (contact.kind !== "customer") throw new UserError("That name isn't a customer.");

      let result: { id: string; number: string | null };
      if (input.type === "invoice") result = await saveInvoice(db, companyId, userId, input, sys);
      else result = await savePayment(db, companyId, userId, input, sys);

      await audit(db, companyId, userId, result.id, before ? "update" : "create", before, await snapshot(db, result.id));
      return result;
    });
  } catch (e) {
    if (e instanceof PostingError) throw new UserError(e.message);
    throw translateDbError(e);
  }
}

function translateDbError(e: unknown): unknown {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err.code === "23505" && err.constraint === "txn_number_unique") return new UserError("That number is already used. Pick another.");
  if (err.code === "23514" && err.message?.includes("closed period")) return new UserError(err.message.replace(/^date/, "The date"));
  if (err.code === "23514" && err.message?.includes("reconciled")) return new UserError("Part of this transaction is reconciled and can't change.");
  return e;
}

async function saveInvoice(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: z.infer<typeof invoiceInput>,
  sys: SystemAccounts,
) {
  // Resolve each line to an income account
  const itemIds = input.lines.map((l) => l.itemId).filter((x): x is string => !!x);
  const items = itemIds.length
    ? await query<{ id: string; income_account_id: string | null; name: string }>(
        "select id, income_account_id, name from items where company_id = $1 and id = any($2::uuid[])",
        [companyId, itemIds],
        db,
      )
    : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const lines: (PostingLine & { itemId: string | null; qty: number | null; rateCents: number | null })[] = input.lines.map((l, idx) => {
    let accountId = l.accountId ?? null;
    if (l.itemId) {
      const item = itemMap.get(l.itemId);
      if (!item) throw new UserError(`Line ${idx + 1}: that product or service no longer exists.`);
      if (!item.income_account_id) throw new UserError(`Line ${idx + 1}: ${item.name} has no income account.`);
      accountId = item.income_account_id;
    }
    if (!accountId) throw new UserError(`Line ${idx + 1}: choose a product or service.`);
    const amount = l.qty != null && l.rateCents != null ? lineAmount(l.qty, l.rateCents) : l.amountCents;
    if (amount !== l.amountCents) throw new UserError(`Line ${idx + 1}: amount doesn't match quantity × rate.`);
    return { accountId, amountCents: amount, taxable: l.taxable, lineId: String(idx), description: l.description ?? null, itemId: l.itemId ?? null, qty: l.qty ?? null, rateCents: l.rateCents ?? null };
  });

  // Sales accounts must be income-type
  const acctIds = [...new Set(lines.map((l) => l.accountId))];
  const accts = await query<{ id: string; type: string }>("select id, type from accounts where company_id = $1 and id = any($2::uuid[])", [companyId, acctIds], db);
  if (accts.length !== acctIds.length) throw new UserError("One of the accounts no longer exists.");

  let taxRateBp: number | null = null;
  if (input.taxRateId) {
    const r = await one<{ rate_bp: number }>("select rate_bp from tax_rates where company_id = $1 and id = $2", [companyId, input.taxRateId], db);
    if (!r) throw new UserError("That tax rate no longer exists.");
    taxRateBp = r.rate_bp;
  }

  const { entries, totals } = post(
    { type: "invoice", date: input.txnDate, contactId: input.contactId, lines, discountCents: input.discountCents, taxRateBp },
    sys,
  );

  const applied = input.id
    ? (await one<{ s: number }>("select coalesce(sum(amount_cents), 0)::bigint as s from payment_applications where target_txn_id = $1", [input.id], db))!.s
    : 0;
  if (totals.totalCents < applied) {
    throw new UserError(`Payments of ${(applied / 100).toFixed(2)} are already applied. The total can't go below that.`);
  }

  const number = input.number || (input.id ? null : await nextNumber(db, companyId, "invoice"));
  const values = [
    companyId, input.contactId, input.txnDate, input.dueDate ?? null, input.termsId ?? null, sys.accountsReceivable,
    input.memo ?? null, input.privateNote ?? null, totals.subtotalCents, totals.discountCents, input.taxRateId ?? null,
    totals.taxCents, totals.totalCents, input.emailTo, userId,
  ];
  let id: string;
  if (input.id) {
    id = input.id;
    await query(
      `update transactions set contact_id = $2, txn_date = $3, due_date = $4, terms_id = $5, account_id = $6, memo = $7, private_note = $8,
         subtotal_cents = $9, discount_cents = $10, tax_rate_id = $11, tax_cents = $12, total_cents = $13, balance_cents = 0, email_to = $14,
         updated_by = $15, number = coalesce($17, number)
       where id = $16`,
      [...values, id, number],
      db,
    );
    await query("delete from transaction_lines where transaction_id = $1", [id], db);
  } else {
    const row = await one<{ id: string }>(
      `insert into transactions (company_id, type, contact_id, txn_date, due_date, terms_id, account_id, memo, private_note,
         subtotal_cents, discount_cents, tax_rate_id, tax_cents, total_cents, balance_cents, email_to, created_by, updated_by, number)
       values ($1, 'invoice', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15, $15, $16) returning id`,
      [...values, number],
      db,
    );
    id = row!.id;
  }

  const lineIds: string[] = [];
  for (const [pos, l] of lines.entries()) {
    const row = await one<{ id: string }>(
      `insert into transaction_lines (company_id, transaction_id, position, kind, item_id, account_id, description, qty, rate_cents, amount_cents, taxable)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [companyId, id, pos, l.itemId ? "item" : "account", l.itemId, l.accountId, l.description, l.qty, l.rateCents, l.amountCents, l.taxable],
      db,
    );
    lineIds.push(row!.id);
  }
  await writeEntries(db, companyId, id, input.txnDate, entries, lineIds);
  await refreshBalances(db, [id]);
  const saved = await one<{ number: string | null }>("select number from transactions where id = $1", [id], db);
  return { id, number: saved!.number };
}

async function savePayment(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: z.infer<typeof paymentInput>,
  sys: SystemAccounts,
) {
  const depositTo = input.depositToId ?? sys.undepositedFunds;
  const dep = await one<{ type: string }>("select type from accounts where company_id = $1 and id = $2", [companyId, depositTo], db);
  if (!dep || !["bank", "other_current_asset"].includes(dep.type)) throw new UserError("Deposit to a bank account or Undeposited Funds.");

  // Previously applied invoices (on edit) need their balances restored too.
  const previousTargets = input.id
    ? (await query<{ target_txn_id: string }>("select target_txn_id from payment_applications where source_txn_id = $1", [input.id], db)).map((r) => r.target_txn_id)
    : [];
  if (input.id) await query("delete from payment_applications where source_txn_id = $1", [input.id], db);

  // Lock target invoices in a stable order, then check each application fits.
  const targetIds = [...new Set(input.applications.map((a) => a.txnId))].sort();
  if (targetIds.length !== input.applications.length) throw new UserError("An invoice is listed twice.");
  if (targetIds.length) {
    await refreshBalances(db, targetIds);
    const targets = await query<{ id: string; type: string; contact_id: string; balance_cents: number; status: string; number: string | null }>(
      "select id, type, contact_id, balance_cents, status, number from transactions where company_id = $1 and id = any($2::uuid[]) order by id for update",
      [companyId, targetIds],
      db,
    );
    const byId = new Map(targets.map((t) => [t.id, t]));
    for (const a of input.applications) {
      const t = byId.get(a.txnId);
      if (!t || t.type !== "invoice" || t.status !== "posted") throw new UserError("An invoice you applied this to no longer exists.");
      if (t.contact_id !== input.contactId) throw new UserError(`Invoice ${t.number} belongs to a different customer.`);
      if (a.amountCents > t.balance_cents) throw new UserError(`Invoice ${t.number} only has ${(t.balance_cents / 100).toFixed(2)} open.`);
    }
  }
  const appliedTotal = input.applications.reduce((s, a) => s + a.amountCents, 0);
  if (appliedTotal > input.amountCents) throw new UserError("You applied more than the amount received.");

  const { entries } = post({ type: "payment", date: input.txnDate, contactId: input.contactId, accountId: depositTo, amountCents: input.amountCents, lines: [] }, sys);

  let id: string;
  const unapplied = input.amountCents - appliedTotal; // stays as a customer credit
  if (input.id) {
    id = input.id;
    await query(
      `update transactions set contact_id = $2, txn_date = $3, account_id = $4, payment_method = $5, number = $6, memo = $7,
         subtotal_cents = $8, total_cents = $8, balance_cents = $9, updated_by = $10 where id = $1`,
      [id, input.contactId, input.txnDate, depositTo, input.paymentMethod ?? null, input.number ?? null, input.memo ?? null, input.amountCents, unapplied, userId],
      db,
    );
  } else {
    const row = await one<{ id: string }>(
      `insert into transactions (company_id, type, contact_id, txn_date, account_id, payment_method, number, memo, subtotal_cents, total_cents, balance_cents, created_by, updated_by)
       values ($1, 'payment', $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $10) returning id`,
      [companyId, input.contactId, input.txnDate, depositTo, input.paymentMethod ?? null, input.number ?? null, input.memo ?? null, input.amountCents, unapplied, userId],
      db,
    );
    id = row!.id;
  }
  for (const a of input.applications) {
    await query(
      "insert into payment_applications (company_id, source_txn_id, target_txn_id, amount_cents) values ($1, $2, $3, $4)",
      [companyId, id, a.txnId, a.amountCents],
      db,
    );
  }
  await writeEntries(db, companyId, id, input.txnDate, entries, []);
  await refreshBalances(db, [...new Set([...targetIds, ...previousTargets])]);
  return { id, number: input.number ?? null };
}
