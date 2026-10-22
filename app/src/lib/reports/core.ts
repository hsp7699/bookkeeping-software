import "server-only";
import { query } from "@/db";
import type { AccountType } from "@/lib/coa";

export type Basis = "accrual" | "cash";

/**
 * A ledger to report from, as SQL yielding (account_id, entry_date, net, transaction_id, contact_id),
 * net = debit − credit. Parameter $1 is the company id.
 *
 * Cash basis: invoices and bills count when paid. Credit memos and vendor
 * credits count when applied, together with the share of the document they
 * settle, so a credit never moves cash. Each payment application
 * brings in the document's non-A/R (non-A/P) lines scaled by amount/total, on
 * the payment date; the rounding remainder goes on the largest line so every
 * application still balances. Payments' A/R side drops out except for any
 * unapplied amount (a customer credit), so the whole thing balances too.
 */
export function ledgerSql(basis: Basis): string {
  if (basis === "accrual") {
    return `select e.account_id, e.entry_date, (e.debit_cents - e.credit_cents)::bigint as net, e.transaction_id, e.contact_id
            from ledger_entries e where e.company_id = $1`;
  }
  return `
    select e.account_id, e.entry_date, (e.debit_cents - e.credit_cents)::bigint as net, e.transaction_id, e.contact_id
    from ledger_entries e join transactions t on t.id = e.transaction_id join accounts a on a.id = e.account_id
    where e.company_id = $1
      and (t.type not in ('invoice','bill','payment','bill_payment','credit_memo','vendor_credit')
           or (t.type in ('payment','bill_payment') and a.type not in ('accounts_receivable','accounts_payable')))
    union all
    select e.account_id, e.entry_date, (sign(e.debit_cents - e.credit_cents) * t.balance_cents)::bigint, e.transaction_id, e.contact_id
    from ledger_entries e join transactions t on t.id = e.transaction_id join accounts a on a.id = e.account_id
    where e.company_id = $1 and t.type in ('payment','bill_payment') and t.balance_cents > 0
      and a.type in ('accounts_receivable','accounts_payable')
    union all
    select x.account_id, x.pay_date, (x.v + case when x.rn = 1 then x.target - x.vsum else 0 end)::bigint, x.doc_id, x.contact_id
    from (
      select s.*, sum(s.v) over (partition by s.app_id, s.doc_id) as vsum
      from (
        -- each application recognises a share of the document it pays (the invoice or bill) ...
        -- ... and, when the source is a credit memo or vendor credit, the same share of that credit
        select pa.id as app_id, e.account_id,
               case when p.type in ('credit_memo','vendor_credit') then greatest(p.txn_date, d0.txn_date) else p.txn_date end as pay_date,
               d.id as doc_id, e.contact_id,
               round((e.debit_cents - e.credit_cents)::numeric * pa.amount_cents / d.total_cents) as v,
               row_number() over (partition by pa.id, d.id order by abs(e.debit_cents - e.credit_cents) desc, e.id) as rn,
               case when d.type in ('invoice','vendor_credit') then -pa.amount_cents else pa.amount_cents end as target
        from payment_applications pa
        join transactions p on p.id = pa.source_txn_id and p.status = 'posted'
        join transactions d0 on d0.id = pa.target_txn_id
        join transactions d on (d.id = pa.target_txn_id or (d.id = pa.source_txn_id and p.type in ('credit_memo','vendor_credit'))) and d.total_cents <> 0
        join ledger_entries e on e.transaction_id = d.id
        join accounts a on a.id = e.account_id
        where pa.company_id = $1 and a.type not in ('accounts_receivable','accounts_payable')
      ) s
    ) x`;
}

export const PNL_TYPES: AccountType[] = ["income", "cost_of_goods_sold", "expense", "other_income", "other_expense"];
export const ASSET_TYPES: AccountType[] = ["bank", "accounts_receivable", "other_current_asset", "fixed_asset", "other_asset"];
export const LIABILITY_TYPES: AccountType[] = ["accounts_payable", "credit_card", "other_current_liability", "long_term_liability"];
const CREDIT_NORMAL = new Set<AccountType>(["accounts_payable", "credit_card", "other_current_liability", "long_term_liability", "equity", "income", "other_income"]);

/** Present a net (debit − credit) in the account's natural sign. */
export function natural(type: AccountType, net: number) {
  return CREDIT_NORMAL.has(type) ? -net : net;
}

export interface AccountAmount {
  id: string;
  name: string;
  number: string | null;
  type: AccountType;
  parent_id: string | null;
  amount: number; // natural sign
}

/** Sum of each account's activity between two dates (inclusive; `from` null = since the beginning). */
export async function accountTotals(companyId: string, basis: Basis, from: string | null, to: string, types: AccountType[]): Promise<AccountAmount[]> {
  const rows = await query<{ id: string; name: string; number: string | null; type: AccountType; parent_id: string | null; net: number }>(
    `select a.id, a.name, a.number, a.type, a.parent_id, sum(l.net)::bigint as net
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id
     where ($2::date is null or l.entry_date >= $2) and l.entry_date <= $3 and a.type = any($4::text[])
     group by a.id having sum(l.net) <> 0
     order by a.number nulls last, lower(a.name)`,
    [companyId, from, to, types],
  );
  return rows.map((r) => ({ ...r, amount: natural(r.type, r.net) }));
}

/** Same, broken out by calendar month: { accountId: { "2026-01": cents } }. */
export async function accountTotalsByMonth(companyId: string, basis: Basis, from: string, to: string, types: AccountType[]) {
  const rows = await query<{ id: string; name: string; number: string | null; type: AccountType; parent_id: string | null; month: string; net: number }>(
    `select a.id, a.name, a.number, a.type, a.parent_id, to_char(l.entry_date, 'YYYY-MM') as month, sum(l.net)::bigint as net
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id
     where l.entry_date >= $2 and l.entry_date <= $3 and a.type = any($4::text[])
     group by a.id, month
     order by a.number nulls last, lower(a.name)`,
    [companyId, from, to, types],
  );
  return rows.map((r) => ({ ...r, amount: natural(r.type, r.net) }));
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** The ledger rows behind a number on a report. */
export async function drilldown(companyId: string, basis: Basis, accountIds: string[], from: string | null, to: string) {
  return query<{ transaction_id: string; type: string; number: string | null; entry_date: string; contact: string | null; memo: string | null; account: string; net: number; account_type: AccountType }>(
    `select l.transaction_id, t.type, t.number, l.entry_date, c.display_name as contact, t.memo, a.name as account, l.net, a.type as account_type
     from (${ledgerSql(basis)}) l join transactions t on t.id = l.transaction_id join accounts a on a.id = l.account_id
     left join contacts c on c.id = coalesce(l.contact_id, t.contact_id)
     where l.account_id = any($2::uuid[]) and ($3::date is null or l.entry_date >= $3) and l.entry_date <= $4 and l.net <> 0
     order by l.entry_date, t.created_at`,
    [companyId, accountIds, from, to],
  );
}
