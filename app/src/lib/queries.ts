import "server-only";
import { one, query } from "@/db";
import type { AccountType } from "@/lib/coa";

/** "Today" in the company's time zone, as YYYY-MM-DD. */
export async function companyToday(companyId: string): Promise<string> {
  const r = await one<{ d: string }>("select (now() at time zone timezone)::date as d from companies where id = $1", [companyId]);
  return r!.d;
}

export interface CustomerRow {
  id: string;
  display_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  open_cents: number;
  overdue_cents: number;
}

export function listCustomers(companyId: string, filter: "all" | "open" | "overdue" = "all") {
  return query<CustomerRow>(
    `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
     select c.id, c.display_name, c.company_name, c.emails[1] as email, c.phone,
            coalesce(sum(t.balance_cents) filter (where t.type = 'invoice'), 0) as open_cents,
            coalesce(sum(t.balance_cents) filter (where t.type = 'invoice' and t.due_date < (select d from today)), 0) as overdue_cents
     from contacts c
     left join transactions t on t.contact_id = c.id and t.status = 'posted' and t.balance_cents > 0
     where c.company_id = $1 and c.kind = 'customer' and c.active
     group by c.id
     having $2 = 'all'
         or ($2 = 'open' and coalesce(sum(t.balance_cents) filter (where t.type = 'invoice'), 0) > 0)
         or ($2 = 'overdue' and coalesce(sum(t.balance_cents) filter (where t.type = 'invoice' and t.due_date < (select d from today)), 0) > 0)
     order by lower(c.display_name)`,
    [companyId, filter],
  );
}

export function customerMoneyBar(companyId: string) {
  return one<{ overdue_count: number; overdue_cents: number; open_count: number; open_cents: number; paid_count: number; paid_cents: number }>(
    `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
     select
       count(*) filter (where type = 'invoice' and balance_cents > 0 and due_date < (select d from today))::int as overdue_count,
       coalesce(sum(balance_cents) filter (where type = 'invoice' and balance_cents > 0 and due_date < (select d from today)), 0) as overdue_cents,
       count(*) filter (where type = 'invoice' and balance_cents > 0)::int as open_count,
       coalesce(sum(balance_cents) filter (where type = 'invoice' and balance_cents > 0), 0) as open_cents,
       count(*) filter (where type = 'invoice' and balance_cents = 0 and total_cents > 0
         and exists (select 1 from payment_applications a join transactions p on p.id = a.source_txn_id
                     where a.target_txn_id = transactions.id and p.txn_date >= (select d from today) - 30))::int as paid_count,
       coalesce(sum(total_cents) filter (where type = 'invoice' and balance_cents = 0 and total_cents > 0
         and exists (select 1 from payment_applications a join transactions p on p.id = a.source_txn_id
                     where a.target_txn_id = transactions.id and p.txn_date >= (select d from today) - 30)), 0) as paid_cents
     from transactions where company_id = $1 and status = 'posted'`,
    [companyId],
  );
}

export function listCustomerOptions(companyId: string) {
  return query<{ id: string; display_name: string; email: string | null; terms_id: string | null; tax_exempt: boolean; default_tax_rate_id: string | null; parent_id: string | null }>(
    "select id, display_name, emails[1] as email, terms_id, tax_exempt, default_tax_rate_id, parent_id from contacts where company_id = $1 and kind = 'customer' and active order by lower(display_name)",
    [companyId],
  );
}

export interface ItemRow {
  id: string;
  name: string;
  type: "service" | "non_inventory";
  sku: string | null;
  description: string | null;
  sales_price_cents: number | null;
  income_account_id: string | null;
  income_account_name: string | null;
  taxable: boolean;
}

export function listItems(companyId: string) {
  return query<ItemRow>(
    `select i.id, i.name, i.type, i.sku, i.description, i.sales_price_cents, i.income_account_id, a.name as income_account_name, i.taxable
     from items i left join accounts a on a.id = i.income_account_id
     where i.company_id = $1 and i.active order by lower(i.name)`,
    [companyId],
  );
}

export function listAccountsByType(companyId: string, types: AccountType[]) {
  return query<{ id: string; name: string; type: AccountType; system_role: string | null }>(
    "select id, name, type, system_role from accounts where company_id = $1 and active and type = any($2::text[]) order by type, lower(name)",
    [companyId, types],
  );
}

export function listTerms(companyId: string) {
  return query<{ id: string; name: string; due_days: number | null }>(
    "select id, name, due_days from terms where company_id = $1 and active order by due_days nulls last, name",
    [companyId],
  );
}

export function listTaxRates(companyId: string) {
  return query<{ id: string; name: string; rate_bp: number }>(
    "select id, name, rate_bp from tax_rates where company_id = $1 and active order by name",
    [companyId],
  );
}

export interface AccountRow {
  id: string;
  name: string;
  number: string | null;
  type: AccountType;
  detail_type: string;
  system_role: string | null;
  parent_id: string | null;
  description: string | null;
  active: boolean;
  balance_cents: number; // in the account's natural sign
}

/** Chart of accounts with balances as of today (balance-sheet accounts only, like QBO). */
export function listAccountsWithBalances(companyId: string, includeInactive = false) {
  return query<AccountRow>(
    `select a.id, a.name, a.number, a.type, a.detail_type, a.system_role, a.parent_id, a.description, a.active,
       case when a.type in ('income','cost_of_goods_sold','expense','other_income','other_expense') then 0
            when a.type in ('bank','accounts_receivable','other_current_asset','fixed_asset','other_asset')
              then coalesce(sum(e.debit_cents - e.credit_cents), 0)
            else coalesce(sum(e.credit_cents - e.debit_cents), 0) end as balance_cents
     from accounts a left join ledger_entries e on e.account_id = a.id
     where a.company_id = $1 and (a.active or $2)
     group by a.id
     order by array_position(array['bank','accounts_receivable','other_current_asset','fixed_asset','other_asset','accounts_payable',
       'credit_card','other_current_liability','long_term_liability','equity','income','cost_of_goods_sold','expense','other_income','other_expense'], a.type),
       lower(a.name)`,
    [companyId, includeInactive],
  );
}

/** Order accounts so each sub-account follows its parent; returns depth for indenting. */
export function asTree<T extends { id: string; parent_id: string | null }>(rows: T[]): (T & { depth: number })[] {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<string, T[]>();
  for (const r of rows) if (r.parent_id && ids.has(r.parent_id)) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  const out: (T & { depth: number })[] = [];
  const walk = (r: T, depth: number) => {
    out.push({ ...r, depth });
    for (const k of kids.get(r.id) ?? []) walk(k, depth + 1);
  };
  for (const r of rows) if (!r.parent_id || !ids.has(r.parent_id)) walk(r, 0);
  return out;
}

export interface InvoiceListRow {
  id: string;
  number: string | null;
  txn_date: string;
  due_date: string | null;
  customer: string;
  contact_id: string;
  total_cents: number;
  balance_cents: number;
  status: string;
  days_overdue: number | null;
}

export function listInvoices(companyId: string, status: "all" | "open" | "overdue" | "paid" = "all") {
  return query<InvoiceListRow>(
    `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
     select t.id, t.number, t.txn_date, t.due_date, c.display_name as customer, t.contact_id, t.total_cents, t.balance_cents, t.status,
            case when t.balance_cents > 0 and t.due_date < (select d from today) then (select d from today) - t.due_date end as days_overdue
     from transactions t join contacts c on c.id = t.contact_id
     where t.company_id = $1 and t.type = 'invoice'
       and ($2 = 'all'
         or ($2 = 'open' and t.balance_cents > 0)
         or ($2 = 'overdue' and t.balance_cents > 0 and t.due_date < (select d from today))
         or ($2 = 'paid' and t.balance_cents = 0 and t.status = 'posted'))
     order by t.txn_date desc, t.number desc nulls last
     limit 500`,
    [companyId, status],
  );
}

export interface InvoiceDetail {
  id: string;
  type: string;
  location_id: string | null;
  tag_ids: string[];
  doc_status: string | null;
  expires_on: string | null;
  linked_from_id: string | null;
  account_id: string | null;
  payment_method: string | null;
  number: string | null;
  contact_id: string;
  txn_date: string;
  due_date: string | null;
  terms_id: string | null;
  memo: string | null;
  private_note: string | null;
  discount_cents: number;
  tax_rate_id: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  balance_cents: number;
  status: string;
  email_to: string[] | null;
  updated_at: string;
  lines: {
    item_id: string | null;
    account_id: string | null;
    description: string | null;
    qty: number | null;
    rate_cents: number | null;
    amount_cents: number;
    taxable: boolean;
    class_id: string | null;
    bills_line_id: string | null;
  }[];
  payments: { id: string; txn_date: string; amount_cents: number }[];
}

/** Any sales form: invoice, sales receipt, credit memo, refund receipt. */
export function getSalesDoc(companyId: string, id: string, type: string) {
  return one<InvoiceDetail>(
    `select t.id, t.type, t.account_id, t.payment_method, t.location_id, t.doc_status, t.expires_on, t.linked_from_id,
            coalesce((select array_agg(tt.tag_id) from transaction_tags tt where tt.transaction_id = t.id), '{}') as tag_ids, t.number, t.contact_id, t.txn_date, t.due_date, t.terms_id, t.memo, t.private_note, t.discount_cents, t.tax_rate_id,
            t.subtotal_cents, t.tax_cents, t.total_cents, t.balance_cents, t.status, t.email_to::text[] as email_to, t.updated_at::text as updated_at,
            coalesce((select json_agg(json_build_object('item_id', l.item_id, 'account_id', l.account_id, 'description', l.description,
               'qty', l.qty, 'rate_cents', l.rate_cents, 'amount_cents', l.amount_cents, 'taxable', l.taxable, 'class_id', l.class_id,
               'bills_line_id', (select x.id from transaction_lines x where x.billed_line_id = l.id limit 1)) order by l.position)
             from transaction_lines l where l.transaction_id = t.id), '[]') as lines,
            coalesce((select json_agg(json_build_object('id', p.id, 'txn_date', p.txn_date, 'amount_cents', a.amount_cents) order by p.txn_date)
             from payment_applications a join transactions p on p.id = a.source_txn_id where a.target_txn_id = t.id), '[]') as payments
     from transactions t where t.company_id = $1 and t.id = $2 and t.type = $3`,
    [companyId, id, type],
  );
}

export function listContactOptions(companyId: string, kinds: ("customer" | "vendor" | "employee" | "other")[]) {
  return query<{ id: string; display_name: string; kind: string; email: string | null; terms_id: string | null; default_account_id: string | null }>(
    `select id, display_name, kind, emails[1] as email, terms_id, default_account_id from contacts
     where company_id = $1 and active and kind = any($2::text[]) order by lower(display_name)`,
    [companyId, kinds],
  );
}

export interface VendorRow {
  id: string;
  display_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  open_cents: number;
  overdue_cents: number;
}

export function listVendors(companyId: string, filter: "all" | "open" | "overdue" = "all") {
  return query<VendorRow>(
    `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
     select c.id, c.display_name, c.company_name, c.emails[1] as email, c.phone,
            coalesce(sum(t.balance_cents) filter (where t.type = 'bill'), 0) as open_cents,
            coalesce(sum(t.balance_cents) filter (where t.type = 'bill' and t.due_date < (select d from today)), 0) as overdue_cents
     from contacts c
     left join transactions t on t.contact_id = c.id and t.status = 'posted' and t.balance_cents > 0
     where c.company_id = $1 and c.kind = 'vendor' and c.active
     group by c.id
     having $2 = 'all'
         or ($2 = 'open' and coalesce(sum(t.balance_cents) filter (where t.type = 'bill'), 0) > 0)
         or ($2 = 'overdue' and coalesce(sum(t.balance_cents) filter (where t.type = 'bill' and t.due_date < (select d from today)), 0) > 0)
     order by lower(c.display_name)`,
    [companyId, filter],
  );
}

export function vendorMoneyBar(companyId: string) {
  return one<{ overdue_count: number; overdue_cents: number; open_count: number; open_cents: number; paid_count: number; paid_cents: number }>(
    `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
     select
       count(*) filter (where type = 'bill' and balance_cents > 0 and due_date < (select d from today))::int as overdue_count,
       coalesce(sum(balance_cents) filter (where type = 'bill' and balance_cents > 0 and due_date < (select d from today)), 0) as overdue_cents,
       count(*) filter (where type = 'bill' and balance_cents > 0)::int as open_count,
       coalesce(sum(balance_cents) filter (where type = 'bill' and balance_cents > 0), 0) as open_cents,
       count(*) filter (where type in ('bill_payment','expense','check') and txn_date >= (select d from today) - 30)::int as paid_count,
       coalesce(sum(total_cents) filter (where type in ('bill_payment','expense','check') and txn_date >= (select d from today) - 30), 0) as paid_cents
     from transactions where company_id = $1 and status = 'posted'`,
    [companyId],
  );
}

export interface PurchaseDetail {
  id: string;
  type: string;
  contact_id: string | null;
  account_id: string | null;
  txn_date: string;
  due_date: string | null;
  terms_id: string | null;
  number: string | null;
  payment_method: string | null;
  memo: string | null;
  total_cents: number;
  balance_cents: number;
  status: string;
  updated_at: string;
  location_id: string | null;
  tag_ids: string[];
  doc_status: string | null;
  linked_from_id: string | null;
  lines: { account_id: string | null; description: string | null; amount_cents: number; contact_id: string | null; class_id: string | null; billable: boolean; billed: boolean }[];
}

export function getPurchaseDoc(companyId: string, id: string, type: string) {
  return one<PurchaseDetail>(
    `select t.id, t.type, t.contact_id, t.account_id, t.txn_date, t.due_date, t.terms_id, t.number, t.payment_method, t.memo,
            t.total_cents, t.balance_cents, t.status, t.updated_at::text as updated_at, t.location_id, t.doc_status, t.linked_from_id,
            coalesce((select array_agg(tt.tag_id) from transaction_tags tt where tt.transaction_id = t.id), '{}') as tag_ids,
            coalesce((select json_agg(json_build_object('account_id', l.account_id, 'description', l.description, 'amount_cents', l.amount_cents,
               'contact_id', l.contact_id, 'class_id', l.class_id, 'billable', l.billable, 'billed', l.billed_line_id is not null) order by l.position)
               from transaction_lines l where l.transaction_id = t.id), '[]') as lines
     from transactions t where t.company_id = $1 and t.id = $2 and t.type = $3`,
    [companyId, id, type],
  );
}

/** Categories for expense lines: anything but A/R, A/P and the bank-side accounts. */
export function listCategoryAccounts(companyId: string) {
  return query<{ id: string; name: string; type: AccountType; parent_id: string | null }>(
    `select id, name, type, parent_id from accounts where company_id = $1 and active
       and type not in ('accounts_receivable','accounts_payable')
     order by array_position(array['expense','cost_of_goods_sold','other_expense','income','other_income','fixed_asset','other_asset',
       'other_current_asset','other_current_liability','long_term_liability','equity','credit_card','bank'], type), lower(name)`,
    [companyId],
  );
}

export interface TrackingLists {
  classes: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

/** Active classes, locations and tags. Forms only show these fields when a list has something in it. */
export async function listTracking(companyId: string): Promise<TrackingLists> {
  const [classes, locations, tags] = await Promise.all([
    query<{ id: string; name: string }>("select id, name from classes where company_id = $1 and active order by lower(name)", [companyId]),
    query<{ id: string; name: string }>("select id, name from locations where company_id = $1 and active order by lower(name)", [companyId]),
    query<{ id: string; name: string }>("select id, name from tags where company_id = $1 order by lower(name)", [companyId]),
  ]);
  return { classes, locations, tags };
}
