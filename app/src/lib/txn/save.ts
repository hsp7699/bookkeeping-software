import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { one, query, tx, type TxOptions } from "@/db";
import { lineAmount } from "@/lib/money";
import { post, PostingError, type PostingInput, type SystemAccounts, type TxnType } from "@/lib/posting";

// One pipeline for every transaction type: validate, resolve item lines to
// accounts, post ledger entries, keep open balances right, number, audit.
// Runs in one database transaction; the balance trigger checks at commit.

export class UserError extends Error {}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");
const uuid = z.string().uuid();

const line = z.object({
  itemId: uuid.nullish(),
  accountId: uuid.nullish(),
  description: z.string().max(4000).nullish(),
  qty: z.number().finite().nullish(),
  rateCents: z.number().finite().nullish(),
  amountCents: z.number().int(),
  taxable: z.boolean().default(false),
  side: z.enum(["debit", "credit"]).nullish(),
  contactId: uuid.nullish(),
  classId: uuid.nullish(),
  /** expense lines: bill this cost to the customer in contactId */
  billable: z.boolean().default(false),
  /** invoice lines: the billable expense line this line bills */
  billsLineId: uuid.nullish(),
});

export const txnInput = z.object({
  type: z.enum([
    "invoice", "sales_receipt", "payment", "credit_memo", "refund_receipt",
    "expense", "check", "bill", "bill_payment", "vendor_credit", "credit_card_credit",
    "deposit", "transfer", "journal_entry", "opening_balance",
    "estimate", "purchase_order", "sales_tax_payment",
  ]),
  id: uuid.optional(),
  ifUpdatedAt: z.string().optional(),
  contactId: uuid.nullish(),
  txnDate: dateStr,
  dueDate: dateStr.nullish(),
  termsId: uuid.nullish(),
  number: z.string().trim().max(21).nullish(),
  /** money side: deposit-to, paid-from, card, transfer-to, opening-balance account */
  accountId: uuid.nullish(),
  /** transfer: from-account */
  fromAccountId: uuid.nullish(),
  /** payment, bill payment, transfer, opening balance */
  amountCents: z.number().int().nullish(),
  paymentMethod: z.string().max(40).nullish(),
  lines: z.array(line).default([]),
  discountCents: z.number().int().min(0).default(0),
  taxRateId: uuid.nullish(),
  memo: z.string().max(4000).nullish(),
  privateNote: z.string().max(4000).nullish(),
  emailTo: z.array(z.string().email()).default([]),
  /** payment -> invoices, bill payment -> bills */
  applications: z.array(z.object({ txnId: uuid, amountCents: z.number().int().positive() })).default([]),
  /** deposit: payments and sales receipts sitting in Undeposited Funds */
  depositSourceIds: z.array(uuid).default([]),
  source: z.enum(["manual", "bank_feed", "import", "recurring", "system"]).default("manual"),
  locationId: uuid.nullish(),
  tagIds: z.array(uuid).default([]),
  /** estimates: pending | accepted | rejected | closed; purchase orders: open | closed */
  docStatus: z.enum(["pending", "accepted", "rejected", "closed", "open"]).nullish(),
  expiresOn: dateStr.nullish(),
  /** invoice made from an estimate, or bill made from a purchase order */
  linkedFromId: uuid.nullish(),
  recurringTemplateId: uuid.nullish(),
});
export type TxnInput = z.input<typeof txnInput>;
type Input = z.infer<typeof txnInput>;

const CUSTOMER_TYPES: TxnType[] = ["invoice", "sales_receipt", "payment", "credit_memo", "refund_receipt", "estimate"];
const VENDOR_TYPES: TxnType[] = ["bill", "bill_payment", "vendor_credit", "purchase_order"];
const SALES_FORMS: TxnType[] = ["invoice", "sales_receipt", "credit_memo", "refund_receipt", "estimate"];
const PURCHASE_FORMS: TxnType[] = ["expense", "check", "bill", "vendor_credit", "credit_card_credit", "purchase_order"];
const NUMBERED: TxnType[] = ["invoice", "sales_receipt", "credit_memo", "refund_receipt", "journal_entry", "estimate", "purchase_order"];

/** Which account types may sit on the money side of each form. */
const MONEY_SIDE: Partial<Record<TxnType, string[]>> = {
  sales_receipt: ["bank", "other_current_asset"],
  payment: ["bank", "other_current_asset"],
  refund_receipt: ["bank", "credit_card"],
  expense: ["bank", "credit_card", "other_current_asset", "other_current_liability"],
  check: ["bank"],
  credit_card_credit: ["credit_card"],
  bill_payment: ["bank", "credit_card"],
  sales_tax_payment: ["bank", "credit_card"],
  deposit: ["bank", "other_current_asset"],
  transfer: ["bank", "credit_card", "other_current_asset", "other_current_liability", "long_term_liability", "equity"],
  opening_balance: ["bank", "credit_card", "accounts_receivable", "other_current_asset", "fixed_asset", "other_asset", "accounts_payable", "other_current_liability", "long_term_liability", "equity"],
};

const MONEY_SIDE_MSG: Partial<Record<TxnType, string>> = {
  sales_receipt: "Deposit to a bank account or Undeposited Funds.",
  payment: "Deposit to a bank account or Undeposited Funds.",
  refund_receipt: "Pay the refund from a bank or credit card account.",
  expense: "Choose the bank or credit card it was paid from.",
  check: "Choose a bank account.",
  credit_card_credit: "Choose a credit card account.",
  bill_payment: "Pay from a bank or credit card account.",
  sales_tax_payment: "Choose the bank or card the tax was paid from.",
  deposit: "Deposit to a bank account.",
  transfer: "Choose balance sheet accounts for a transfer.",
  opening_balance: "Opening balances go on balance sheet accounts.",
};

export async function systemAccounts(db: PoolClient, companyId: string): Promise<SystemAccounts> {
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
  let n = row!.next_value;
  // skip numbers the user typed by hand
  while (await one("select 1 from transactions where company_id = $1 and type = $2 and number = $3", [companyId, type, String(n)], db)) n++;
  await query("update number_sequences set next_value = $3 where company_id = $1 and type = $2", [companyId, type, n + 1], db);
  return String(n);
}

/** Recompute open balances from applications. Invoices/bills: total − applied. Payments: unapplied. */
export async function refreshBalances(db: PoolClient, txnIds: string[]) {
  if (txnIds.length === 0) return;
  await query(
    `update transactions t set balance_cents = case
        when t.status = 'voided' then 0
        when t.type in ('invoice','bill') then
          greatest(t.total_cents - coalesce((select sum(a.amount_cents) from payment_applications a where a.target_txn_id = t.id), 0), 0)
        when t.type in ('payment','bill_payment') then
          greatest(t.total_cents - coalesce((select sum(a.amount_cents) from payment_applications a where a.source_txn_id = t.id), 0), 0)
        when t.type in ('credit_memo','vendor_credit') then
          greatest(t.total_cents - coalesce((select sum(a.amount_cents) from payment_applications a where a.source_txn_id = t.id), 0), 0)
        else 0 end
     where t.id = any($1::uuid[])`,
    [txnIds],
    db,
  );
}

async function audit(db: PoolClient, companyId: string, userId: string, id: string, action: string, before: unknown, after: unknown) {
  await query(
    `insert into audit_events (company_id, user_id, entity, entity_id, action, before, after) values ($1, $2, 'transaction', $3, $4, $5, $6)`,
    [companyId, userId, id, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
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

function translateDbError(e: unknown): unknown {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err.code === "23505" && err.constraint === "txn_number_unique") return new UserError("That number is already used. Pick another.");
  if (err.code === "23514" && err.message?.includes("closed period")) return new UserError(err.message.replace(/^date/, "The date").replace(/^transaction dated/, "This transaction, dated") + ". Enter the close-books password to change it.");
  if (err.code === "23514" && err.message?.includes("reconciled")) return new UserError("Part of this transaction is reconciled, so changing it would throw off that reconciliation. To change it, undo the reconciliation first (Reconcile → History).");
  if (err.code === "23503" && err.message?.includes("payment_applications")) return new UserError("Payments are applied to this. Delete or edit those payments first.");
  if (err.code === "23503" && err.message?.includes("deposit_items")) return new UserError("This payment is part of a bank deposit. Remove it from the deposit first.");
  return e;
}

export async function saveTransaction(
  companyId: string,
  userId: string,
  raw: unknown,
  opts: TxOptions = {},
): Promise<{ id: string; number: string | null }> {
  const parsed = txnInput.safeParse(raw);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Check the form for errors.");
  try {
    return await tx((db) => saveInDb(db, companyId, userId, parsed.data), opts);
  } catch (e) {
    if (e instanceof PostingError) throw new UserError(e.message);
    throw translateDbError(e);
  }
}

/** For callers that already hold a database transaction (bank feed "Add"). */
export async function saveInDb(db: PoolClient, companyId: string, userId: string, input: Input): Promise<{ id: string; number: string | null }> {
  const sys = await systemAccounts(db, companyId);
  const before = input.id ? await snapshot(db, input.id) : null;

  if (input.id) {
    const row = await one<{ type: string; status: string; unchanged: boolean }>(
      `select type, status, ($3::text is null or updated_at = $3::timestamptz) as unchanged
       from transactions where company_id = $1 and id = $2 for update`,
      [companyId, input.id, input.ifUpdatedAt ?? null],
      db,
    );
    if (!row || row.type !== input.type) throw new UserError("This transaction no longer exists.");
    if (row.status === "voided") throw new UserError("A voided transaction can't be edited.");
    if (!row.unchanged) throw new UserError("Someone else changed this transaction while you were editing. Reload to see their changes.");
  }

  // Contact
  if (input.contactId) {
    const c = await one<{ kind: string }>("select kind from contacts where company_id = $1 and id = $2", [companyId, input.contactId], db);
    if (!c) throw new UserError("That name no longer exists.");
    if (CUSTOMER_TYPES.includes(input.type) && c.kind !== "customer") throw new UserError("Choose a customer.");
    if (VENDOR_TYPES.includes(input.type) && c.kind !== "vendor") throw new UserError("Choose a vendor.");
  } else if (CUSTOMER_TYPES.includes(input.type)) throw new UserError("Choose a customer.");
  else if (VENDOR_TYPES.includes(input.type)) throw new UserError("Choose a vendor.");

  // Money-side account
  let moneyAccount = input.accountId ?? null;
  if (input.type === "payment" && !moneyAccount) moneyAccount = sys.undepositedFunds;
  if (input.type === "sales_receipt" && !moneyAccount) moneyAccount = sys.undepositedFunds;
  const allowed = MONEY_SIDE[input.type];
  if (allowed) {
    if (!moneyAccount) throw new UserError(MONEY_SIDE_MSG[input.type] ?? "Choose an account.");
    const a = await one<{ type: string; system_role: string | null }>("select type, system_role from accounts where company_id = $1 and id = $2", [companyId, moneyAccount], db);
    if (!a || !allowed.includes(a.type)) throw new UserError(MONEY_SIDE_MSG[input.type] ?? "Choose a different account.");
    if (input.type === "deposit" && a.system_role === "undeposited_funds") throw new UserError("Deposit to a bank account, not Undeposited Funds.");
  }
  if (input.type === "transfer") {
    const a = await one<{ type: string }>("select type from accounts where company_id = $1 and id = $2", [companyId, input.fromAccountId ?? null], db);
    if (!a || !MONEY_SIDE.transfer!.includes(a.type)) throw new UserError("Choose the account to transfer from.");
  }

  // Lines: resolve items to accounts, check math, check accounts exist
  const lines: (ResolvedLine & { isSource?: boolean })[] = await resolveLines(db, companyId, input);

  // Deposits: grouped Undeposited Funds payments become lines
  let depositSources: { id: string; amount: number }[] = [];
  if (input.type === "deposit" && input.depositSourceIds.length) {
    const ids = [...new Set(input.depositSourceIds)];
    const rows = await query<{ id: string; total_cents: number; account_id: string; status: string; deposited_in: string | null; contact_id: string | null }>(
      `select t.id, t.total_cents, t.account_id, t.status, d.deposit_txn_id as deposited_in, t.contact_id
       from transactions t left join deposit_items d on d.source_txn_id = t.id
       where t.company_id = $1 and t.id = any($2::uuid[]) and t.type in ('payment','sales_receipt') for update of t`,
      [companyId, ids],
      db,
    );
    if (rows.length !== ids.length) throw new UserError("A payment in this deposit no longer exists.");
    for (const r of rows) {
      if (r.status !== "posted") throw new UserError("A voided payment can't be deposited.");
      if (r.account_id !== sys.undepositedFunds) throw new UserError("Only payments held in Undeposited Funds can be grouped into a deposit.");
      if (r.deposited_in && r.deposited_in !== input.id) throw new UserError("A payment you picked is already in another deposit.");
    }
    depositSources = rows.map((r) => ({ id: r.id, amount: r.total_cents }));
    lines.unshift(
      ...rows.map((r) => ({
        accountId: sys.undepositedFunds,
        amountCents: r.total_cents,
        contactId: r.contact_id,
        itemId: null,
        qty: null,
        rateCents: null,
        description: null,
        taxable: false,
        side: null,
        kind: "account" as const,
        classId: null,
        billable: false,
        billsLineId: null,
        isSource: true,
      })),
    );
  }

  let taxRateBp: number | null = null;
  if (input.taxRateId && input.contactId && SALES_FORMS.includes(input.type)) {
    const ex = await one<{ tax_exempt: boolean }>("select tax_exempt from contacts where id = $1", [input.contactId], db);
    if (ex?.tax_exempt) throw new UserError("This customer is tax exempt, so this can't charge sales tax.");
  }
  if (input.taxRateId) {
    const r = await one<{ rate_bp: number }>("select rate_bp from tax_rates where company_id = $1 and id = $2", [companyId, input.taxRateId], db);
    if (!r) throw new UserError("That tax rate no longer exists.");
    taxRateBp = r.rate_bp;
  }

  const postingInput: PostingInput = {
    type: input.type,
    date: input.txnDate,
    contactId: input.contactId ?? null,
    accountId: moneyAccount,
    fromAccountId: input.fromAccountId ?? null,
    amountCents: input.amountCents ?? undefined,
    lines: lines.map((l, i) => ({
      accountId: l.accountId,
      amountCents: l.amountCents,
      taxable: l.taxable,
      side: l.side ?? undefined,
      contactId: l.contactId,
      description: l.description,
      lineId: String(i),
      classId: l.classId,
    })),
    discountCents: input.discountCents,
    taxRateBp,
  };
  const { entries, totals } = post(postingInput, sys);

  // Applications (payments to invoices, bill payments to bills)
  const previousTargets = input.id
    ? (await query<{ target_txn_id: string }>("select target_txn_id from payment_applications where source_txn_id = $1", [input.id], db)).map((r) => r.target_txn_id)
    : [];
  const targetIds = [...new Set(input.applications.map((a) => a.txnId))].sort();
  if (input.applications.length) {
    if (input.type !== "payment" && input.type !== "bill_payment") throw new UserError("Only payments can be applied to invoices or bills.");
    if (targetIds.length !== input.applications.length) throw new UserError("A document is listed twice.");
    const targetType = input.type === "payment" ? "invoice" : "bill";
    if (input.id) await query("delete from payment_applications where source_txn_id = $1", [input.id], db);
    await refreshBalances(db, targetIds);
    const targets = await query<{ id: string; type: string; contact_id: string; balance_cents: number; status: string; number: string | null }>(
      "select id, type, contact_id, balance_cents, status, number from transactions where company_id = $1 and id = any($2::uuid[]) order by id for update",
      [companyId, targetIds],
      db,
    );
    const byId = new Map(targets.map((t) => [t.id, t]));
    const label = targetType === "invoice" ? "Invoice" : "Bill";
    for (const a of input.applications) {
      const t = byId.get(a.txnId);
      if (!t || t.type !== targetType || t.status !== "posted") throw new UserError(`A ${targetType} you applied this to no longer exists.`);
      if (t.contact_id !== input.contactId) throw new UserError(`${label} ${t.number ?? ""} belongs to someone else.`);
      if (a.amountCents > t.balance_cents) throw new UserError(`${label} ${t.number ?? ""} only has ${(t.balance_cents / 100).toFixed(2)} open.`);
    }
    const applied = input.applications.reduce((s, a) => s + a.amountCents, 0);
    if (applied > totals.totalCents) throw new UserError("You applied more than the payment amount.");
  } else if (input.id) {
    await query("delete from payment_applications where source_txn_id = $1", [input.id], db);
  }

  // A document can't drop below what's already been paid on it
  if (input.id && (input.type === "invoice" || input.type === "bill")) {
    const paid = (await one<{ s: number }>("select coalesce(sum(amount_cents), 0)::bigint as s from payment_applications where target_txn_id = $1", [input.id], db))!.s;
    if (totals.totalCents < paid) throw new UserError(`Payments of ${(paid / 100).toFixed(2)} are already applied. The total can't go below that.`);
  }

  // An invoice made from an estimate (or a bill from a purchase order) must be for the same name
  if (input.linkedFromId) {
    const src = await one<{ type: string; contact_id: string | null }>("select type, contact_id from transactions where company_id = $1 and id = $2", [companyId, input.linkedFromId], db);
    const want = input.type === "invoice" ? "estimate" : input.type === "bill" ? "purchase_order" : null;
    if (!src || src.type !== want) throw new UserError("The estimate or purchase order this came from no longer exists.");
    if (src.contact_id !== input.contactId) throw new UserError("This must be for the same name as the document it came from.");
  }
  const previousLinked = input.id ? (await one<{ l: string | null }>("select linked_from_id as l from transactions where id = $1", [input.id], db))?.l ?? null : null;

  // Header
  const number = input.number || (input.id || !NUMBERED.includes(input.type) ? null : await nextNumber(db, companyId, input.type));
  const header = [
    input.contactId ?? null, input.txnDate, input.dueDate ?? null, input.termsId ?? null,
    input.type === "invoice" || input.type === "credit_memo" ? sys.accountsReceivable : input.type === "bill" || input.type === "vendor_credit" ? sys.accountsPayable : moneyAccount,
    input.paymentMethod ?? null, input.memo ?? null, input.privateNote ?? null,
    totals.subtotalCents, totals.discountCents, input.taxRateId ?? null, totals.taxCents, totals.totalCents, input.emailTo, userId,
  ];
  let billedLinks: { position: number; billed_line_id: string; contact_id: string | null }[] = [];
  const docStatus = input.docStatus ?? (input.id ? null : input.type === "estimate" ? "pending" : input.type === "purchase_order" ? "open" : null);
  let id: string;
  if (input.id) {
    id = input.id;
    await query(
      `update transactions set contact_id = $1, txn_date = $2, due_date = $3, terms_id = $4, account_id = $5, payment_method = $6, memo = $7,
         private_note = $8, subtotal_cents = $9, discount_cents = $10, tax_rate_id = $11, tax_cents = $12, total_cents = $13, balance_cents = 0,
         email_to = $14, updated_by = $15, number = coalesce($17, number), location_id = $18, doc_status = coalesce($19, doc_status),
         expires_on = $20, linked_from_id = $21
       where id = $16`,
      [...header, id, number, input.locationId ?? null, docStatus, input.expiresOn ?? null, input.linkedFromId ?? null],
      db,
    );
    // keep "already billed" links on billable expense lines through an edit (matched by position)
    billedLinks = await query<{ position: number; billed_line_id: string; contact_id: string | null }>(
      "select position, billed_line_id, contact_id from transaction_lines where transaction_id = $1 and billed_line_id is not null",
      [id],
      db,
    );
    await query("delete from deposit_items where deposit_txn_id = $1", [id], db);
    await query("delete from ledger_entries where transaction_id = $1", [id], db);
    await query("delete from transaction_lines where transaction_id = $1", [id], db);
  } else {
    const row = await one<{ id: string }>(
      `insert into transactions (company_id, type, contact_id, txn_date, due_date, terms_id, account_id, payment_method, memo, private_note,
         subtotal_cents, discount_cents, tax_rate_id, tax_cents, total_cents, balance_cents, email_to, created_by, updated_by, number, source,
         location_id, doc_status, expires_on, linked_from_id, recurring_template_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, $16, $17, $17, $18, $19, $20, $21, $22, $23, $24) returning id`,
      [companyId, input.type, ...header, number, input.source, input.locationId ?? null, docStatus, input.expiresOn ?? null, input.linkedFromId ?? null, input.recurringTemplateId ?? null],
      db,
    );
    id = row!.id;
  }

  // Lines (deposit source lines are represented by deposit_items, not lines)
  const lineIds: (string | null)[] = [];
  let pos = 0;
  for (const l of lines) {
    if (l.isSource) {
      lineIds.push(null);
      continue;
    }
    const row = await one<{ id: string }>(
      `insert into transaction_lines (company_id, transaction_id, position, kind, item_id, account_id, description, qty, rate_cents, amount_cents, taxable, contact_id, class_id, billable)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [companyId, id, pos++, l.kind, l.itemId, l.accountId, l.description, l.qty, l.rateCents, l.amountCents, l.taxable, l.contactId, l.classId, l.billable],
      db,
    );
    lineIds.push(row!.id);
    if (l.billsLineId) {
      // mark the billable expense line as billed by this invoice line
      const billed = await one(
        `update transaction_lines set billed_line_id = $1
         where company_id = $2 and id = $3 and billable and contact_id = $4 and billed_line_id is null returning id`,
        [row!.id, companyId, l.billsLineId, input.contactId],
        db,
      );
      if (!billed) throw new UserError("A billable expense on this invoice was already billed, or belongs to another customer.");
    }
  }
  for (const b of billedLinks) {
    const kept = await one(
      "update transaction_lines set billed_line_id = $3 where transaction_id = $1 and position = $2 and billable and contact_id is not distinct from $4 returning id",
      [id, b.position, b.billed_line_id, b.contact_id],
      db,
    );
    if (!kept) throw new UserError("A line on this was already billed to a customer. Keep it billable for the same customer, or remove it from that invoice first.");
  }
  await query("delete from transaction_tags where transaction_id = $1", [id], db);
  if (input.tagIds.length) {
    await query(
      "insert into transaction_tags (transaction_id, tag_id) select $1, t.id from tags t where t.company_id = $2 and t.id = any($3::uuid[]) on conflict do nothing",
      [id, companyId, input.tagIds],
      db,
    );
  }
  for (const s of depositSources) await query("insert into deposit_items (deposit_txn_id, source_txn_id) values ($1, $2)", [id, s.id], db);
  for (const a of input.applications) {
    await query("insert into payment_applications (company_id, source_txn_id, target_txn_id, amount_cents) values ($1, $2, $3, $4)", [companyId, id, a.txnId, a.amountCents], db);
  }

  // Ledger
  for (const e of entries) {
    const lineId = e.lineId != null ? lineIds[Number(e.lineId)] ?? null : null;
    await query(
      `insert into ledger_entries (company_id, transaction_id, line_id, account_id, entry_date, debit_cents, credit_cents, contact_id, memo, class_id, location_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [companyId, id, lineId, e.accountId, input.txnDate, e.debitCents, e.creditCents, e.contactId, e.memo, e.classId, input.locationId ?? null],
      db,
    );
  }

  await refreshBalances(db, [...new Set([id, ...targetIds, ...previousTargets])]);
  for (const src of new Set([input.linkedFromId, previousLinked].filter((x): x is string => !!x))) await refreshDocStatus(db, src);
  await audit(db, companyId, userId, id, before ? "update" : "create", before, await snapshot(db, id));
  const saved = await one<{ number: string | null }>("select number from transactions where id = $1", [id], db);
  return { id, number: saved!.number };
}

type ResolvedLine = {
  kind: "item" | "account" | "debit" | "credit";
  itemId: string | null;
  accountId: string;
  description: string | null;
  qty: number | null;
  rateCents: number | null;
  amountCents: number;
  taxable: boolean;
  side: "debit" | "credit" | null;
  contactId: string | null;
  classId: string | null;
  billable: boolean;
  billsLineId: string | null;
};

async function resolveLines(db: PoolClient, companyId: string, input: Input): Promise<ResolvedLine[]> {
  const itemIds = input.lines.map((l) => l.itemId).filter((x): x is string => !!x);
  const items = itemIds.length
    ? await query<{ id: string; name: string; income_account_id: string | null; expense_account_id: string | null }>(
        "select id, name, income_account_id, expense_account_id from items where company_id = $1 and id = any($2::uuid[])",
        [companyId, itemIds],
        db,
      )
    : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const isSales = SALES_FORMS.includes(input.type);
  const isPurchase = PURCHASE_FORMS.includes(input.type);

  const out: ResolvedLine[] = input.lines.map((l, idx) => {
    const n = idx + 1;
    let accountId = l.accountId ?? null;
    if (l.itemId) {
      if (!isSales && !isPurchase) throw new UserError(`Line ${n}: products and services can't go on this form.`);
      const item = itemMap.get(l.itemId);
      if (!item) throw new UserError(`Line ${n}: that product or service no longer exists.`);
      accountId = isSales ? item.income_account_id : item.expense_account_id ?? item.income_account_id;
      if (!accountId) throw new UserError(`Line ${n}: ${item.name} has no ${isSales ? "income" : "expense"} account.`);
    }
    if (!accountId) throw new UserError(isSales ? `Line ${n}: choose a product or service.` : `Line ${n}: choose a category.`);
    let amount = l.amountCents;
    if (l.qty != null && l.rateCents != null) {
      amount = lineAmount(l.qty, l.rateCents);
      if (amount !== l.amountCents) throw new UserError(`Line ${n}: the amount doesn't match quantity × rate.`);
    }
    if (input.type === "journal_entry" && !l.side) throw new UserError(`Line ${n}: enter a debit or a credit.`);
    return {
      kind: input.type === "journal_entry" ? (l.side as "debit" | "credit") : l.itemId ? "item" : "account",
      itemId: l.itemId ?? null,
      accountId,
      description: l.description ?? null,
      qty: l.qty ?? null,
      rateCents: l.rateCents ?? null,
      amountCents: amount,
      taxable: l.taxable,
      side: l.side ?? null,
      contactId: l.contactId ?? null,
      classId: l.classId ?? null,
      billable: !!l.billable && !!l.contactId,
      billsLineId: input.type === "invoice" ? l.billsLineId ?? null : null,
    };
  });

  const acctIds = [...new Set(out.map((l) => l.accountId))];
  if (acctIds.length) {
    const accts = await query<{ id: string; type: string; system_role: string | null }>(
      "select id, type, system_role from accounts where company_id = $1 and id = any($2::uuid[])",
      [companyId, acctIds],
      db,
    );
    if (accts.length !== acctIds.length) throw new UserError("One of the accounts no longer exists.");
    const byId = new Map(accts.map((a) => [a.id, a]));
    for (const [i, l] of out.entries()) {
      const a = byId.get(l.accountId)!;
      // A/R and A/P need a name on every entry for aging to work
      if (input.type === "journal_entry" && (a.type === "accounts_receivable" || a.type === "accounts_payable") && !l.contactId) {
        throw new UserError(`Line ${i + 1}: choose a customer or vendor for ${a.type === "accounts_receivable" ? "Accounts Receivable" : "Accounts Payable"}.`);
      }
      if (input.type !== "journal_entry" && (a.type === "accounts_receivable" || a.type === "accounts_payable")) {
        throw new UserError(`Line ${i + 1}: use an invoice, bill or payment for ${a.type === "accounts_receivable" ? "Accounts Receivable" : "Accounts Payable"}.`);
      }
    }
  }
  return out;
}

/** Void: keep the record and its number, post nothing, unlink payments it made. */
export async function voidTransaction(companyId: string, userId: string, id: string, opts: TxOptions = {}) {
  try {
    await tx(async (db) => {
      const before = await snapshot(db, id);
      const t = await one<{ type: string; status: string }>("select type, status from transactions where company_id = $1 and id = $2 for update", [companyId, id], db);
      if (!t) throw new UserError("This transaction no longer exists.");
      if (t.status === "voided") throw new UserError("This is already voided.");
      const paidOn = await one("select 1 from payment_applications where target_txn_id = $1", [id], db);
      if (paidOn) throw new UserError("Payments are applied to this. Delete or void those payments first.");
      const inDeposit = await one("select 1 from deposit_items where source_txn_id = $1", [id], db);
      if (inDeposit) throw new UserError("This payment is part of a bank deposit. Remove it from the deposit first.");
      const targets = (await query<{ target_txn_id: string }>("select target_txn_id from payment_applications where source_txn_id = $1", [id], db)).map((r) => r.target_txn_id);
      await query("delete from payment_applications where source_txn_id = $1", [id], db);
      await query("delete from deposit_items where deposit_txn_id = $1", [id], db);
      await query("delete from ledger_entries where transaction_id = $1", [id], db);
      await query(
        "update transactions set status = 'voided', voided_at = now(), balance_cents = 0, updated_by = $2, private_note = concat_ws(E'\\n', private_note, 'Voided') where id = $1",
        [id, userId],
        db,
      );
      await refreshBalances(db, targets);
      await audit(db, companyId, userId, id, "void", before, await snapshot(db, id));
    }, opts);
  } catch (e) {
    throw translateDbError(e);
  }
}

/** Delete: remove the transaction entirely. */
export async function deleteTransaction(companyId: string, userId: string, id: string, opts: TxOptions = {}) {
  try {
    await tx(async (db) => {
      const before = await snapshot(db, id);
      if (!before) throw new UserError("This transaction no longer exists.");
      const targets = (await query<{ target_txn_id: string }>("select target_txn_id from payment_applications where source_txn_id = $1", [id], db)).map((r) => r.target_txn_id);
      await query("update bank_feed_txns set status = 'for_review', created_txn_id = null, reviewed_at = null where created_txn_id = $1", [id], db);
      await query("update bank_feed_txns set status = 'for_review', matched_txn_id = null, reviewed_at = null where matched_txn_id = $1", [id], db);
      await query("delete from transactions where company_id = $1 and id = $2", [companyId, id], db);
      await refreshBalances(db, targets);
      await audit(db, companyId, userId, id, "delete", before, null);
    }, opts);
  } catch (e) {
    throw translateDbError(e);
  }
}

/**
 * An estimate closes once invoices made from it cover its total; a purchase
 * order closes once bills cover it. Rejected estimates stay rejected.
 */
export async function refreshDocStatus(db: PoolClient, docId: string) {
  await query(
    `update transactions d set doc_status = case
        when d.doc_status = 'rejected' then 'rejected'
        when coalesce((select sum(t.total_cents) from transactions t where t.linked_from_id = d.id and t.status = 'posted'), 0) >= d.total_cents and d.total_cents > 0 then 'closed'
        when d.type = 'estimate' and exists (select 1 from transactions t where t.linked_from_id = d.id and t.status = 'posted') then 'accepted'
        when d.type = 'estimate' and d.doc_status = 'closed' then 'accepted'
        when d.type = 'purchase_order' then 'open'
        else d.doc_status end
     where d.id = $1 and d.type in ('estimate','purchase_order')`,
    [docId],
    db,
  );
}
