import "server-only";
import { query } from "@/db";
import type { AccountType } from "@/lib/coa";
import { fiscalYearStart } from "@/lib/dates";
import { PNL_TYPES, ledgerSql, type Basis } from "./core";

// ------------------------------------------------------------------ trial balance

export interface TbRow {
  id: string | null;
  name: string;
  type: AccountType | "equity";
  debit: number;
  credit: number;
}

/**
 * Balance sheet accounts with their balance to date; income and expense
 * accounts with this fiscal year's activity; earlier years' profit shown as
 * retained earnings. Debits always equal credits.
 */
export async function trialBalance(companyId: string, asOf: string, basis: Basis, fyStartMonth: number) {
  const fy = fiscalYearStart(asOf, fyStartMonth);
  const rows = await query<{ id: string; name: string; number: string | null; type: AccountType; system_role: string | null; net: number }>(
    `select a.id, a.name, a.number, a.type, a.system_role,
            sum(case when a.type = any($4::text[]) and l.entry_date < $3 then 0 else l.net end)::bigint as net
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id
     where l.entry_date <= $2
     group by a.id
     order by array_position(array['bank','accounts_receivable','other_current_asset','fixed_asset','other_asset','accounts_payable','credit_card',
       'other_current_liability','long_term_liability','equity','income','cost_of_goods_sold','expense','other_income','other_expense'], a.type),
       a.number nulls last, lower(a.name)`,
    [companyId, asOf, fy, PNL_TYPES],
  );
  const prior = await query<{ net: number }>(
    `select coalesce(sum(l.net), 0)::bigint as net from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id
     where l.entry_date < $2 and a.type = any($3::text[])`,
    [companyId, fy, PNL_TYPES],
  );
  const out: TbRow[] = [];
  let reAdded = false;
  for (const r of rows) {
    let net = r.net;
    if (r.system_role === "retained_earnings") {
      net += prior[0].net;
      reAdded = true;
    }
    if (net === 0) continue;
    out.push({ id: r.id, name: r.name, type: r.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  if (!reAdded && prior[0].net !== 0) {
    const net = prior[0].net;
    out.push({ id: null, name: "Retained Earnings", type: "equity", debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  return { rows: out, debit: out.reduce((s, r) => s + r.debit, 0), credit: out.reduce((s, r) => s + r.credit, 0) };
}

// ------------------------------------------------------------------ cash flow

export interface CashFlowLine {
  id: string | null;
  name: string;
  amount: number;
}
export interface CashFlow {
  netIncome: number;
  operating: CashFlowLine[];
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  netOperating: number;
  netInvesting: number;
  netFinancing: number;
  netChange: number;
  cashStart: number;
  cashEnd: number;
}

const OPERATING: AccountType[] = ["accounts_receivable", "other_current_asset", "accounts_payable", "credit_card", "other_current_liability"];
const INVESTING: AccountType[] = ["fixed_asset", "other_asset"];
const FINANCING: AccountType[] = ["long_term_liability", "equity"];

/**
 * Indirect method: net income, adjusted by the change in every non-cash
 * balance sheet account. Cash is the bank accounts. The net change always
 * equals the change in bank balances, because the ledger balances.
 */
export async function cashFlow(companyId: string, from: string, to: string, basis: Basis): Promise<CashFlow> {
  const rows = await query<{ id: string; name: string; type: AccountType; net: number }>(
    `select a.id, a.name, a.type, sum(l.net)::bigint as net
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id
     where l.entry_date between $2 and $3 group by a.id having sum(l.net) <> 0 order by lower(a.name)`,
    [companyId, from, to],
  );
  const cash = await query<{ start: number; end_: number }>(
    `select coalesce(sum(l.net) filter (where l.entry_date < $2), 0)::bigint as start, coalesce(sum(l.net) filter (where l.entry_date <= $3), 0)::bigint as end_
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id where a.type = 'bank'`,
    [companyId, from, to],
  );
  // a debit increase in a non-cash account used cash: its effect on cash is −net
  const lines = (types: AccountType[]) => rows.filter((r) => types.includes(r.type)).map((r) => ({ id: r.id, name: r.name, amount: -r.net }));
  const netIncome = -rows.filter((r) => PNL_TYPES.includes(r.type)).reduce((s, r) => s + r.net, 0);
  const operating = lines(OPERATING);
  const investing = lines(INVESTING);
  const financing = lines(FINANCING);
  const sum = (l: CashFlowLine[]) => l.reduce((s, x) => s + x.amount, 0);
  const netOperating = netIncome + sum(operating);
  return {
    netIncome,
    operating,
    investing,
    financing,
    netOperating,
    netInvesting: sum(investing),
    netFinancing: sum(financing),
    netChange: netOperating + sum(investing) + sum(financing),
    cashStart: cash[0].start,
    cashEnd: cash[0].end_,
  };
}

// ------------------------------------------------------------------ sales and expenses by name / product

/** Income by customer (the name on the transaction), on either basis. */
export async function salesByCustomer(companyId: string, from: string, to: string, basis: Basis) {
  return query<{ contact_id: string | null; name: string; amount: number }>(
    `select c.id as contact_id, coalesce(c.display_name, 'No customer') as name, (-sum(l.net))::bigint as amount
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id
     join transactions t on t.id = l.transaction_id left join contacts c on c.id = t.contact_id
     where l.entry_date between $2 and $3 and a.type in ('income','other_income')
     group by c.id, c.display_name having sum(l.net) <> 0 order by amount desc`,
    [companyId, from, to],
  );
}

/** Expenses by vendor (the name on the transaction), on either basis. */
export async function expensesByVendor(companyId: string, from: string, to: string, basis: Basis) {
  return query<{ contact_id: string | null; name: string; amount: number }>(
    `select c.id as contact_id, coalesce(c.display_name, 'No vendor') as name, sum(l.net)::bigint as amount
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id
     join transactions t on t.id = l.transaction_id left join contacts c on c.id = t.contact_id
     where l.entry_date between $2 and $3 and a.type in ('expense','cost_of_goods_sold','other_expense')
     group by c.id, c.display_name having sum(l.net) <> 0 order by amount desc`,
    [companyId, from, to],
  );
}

/** Quantity and amount sold per product or service (accrual: from the sales forms themselves). */
export async function salesByProduct(companyId: string, from: string, to: string) {
  return query<{ item_id: string | null; name: string; qty: number; amount: number; avg_price: number | null }>(
    `select i.id as item_id, coalesce(i.name, 'Not a product or service') as name,
            sum(case when t.type in ('credit_memo','refund_receipt') then -coalesce(l.qty, 0) else coalesce(l.qty, 0) end)::numeric as qty,
            sum(case when t.type in ('credit_memo','refund_receipt') then -l.amount_cents else l.amount_cents end)::bigint as amount,
            null::numeric as avg_price
     from transaction_lines l join transactions t on t.id = l.transaction_id left join items i on i.id = l.item_id
     where t.company_id = $1 and t.status = 'posted' and t.type in ('invoice','sales_receipt','credit_memo','refund_receipt')
       and t.txn_date between $2 and $3
     group by i.id, i.name order by amount desc`,
    [companyId, from, to],
  ).then((rows) => rows.map((r) => ({ ...r, qty: Number(r.qty), avg_price: Number(r.qty) ? Math.round(r.amount / Number(r.qty)) : null })));
}

// ------------------------------------------------------------------ sales tax

export interface TaxRateLiability {
  rate_id: string | null;
  name: string;
  agency: string | null;
  rate_bp: number | null;
  taxable_cents: number;
  tax_cents: number;
}

/**
 * Tax charged per rate in a period (accrual: when invoiced), what was paid to
 * agencies in the period, and what Sales Tax Payable shows as owed at the end.
 */
export async function salesTaxLiability(companyId: string, from: string, to: string) {
  const byRate = await query<TaxRateLiability>(
    `select r.id as rate_id, coalesce(r.name, 'No rate') as name, r.agency, r.rate_bp,
            sum(case when t.type in ('credit_memo','refund_receipt') then -1 else 1 end *
                (select coalesce(sum(l.amount_cents) filter (where l.taxable), 0) from transaction_lines l where l.transaction_id = t.id))::bigint
              - sum(case when t.type in ('credit_memo','refund_receipt') then -1 else 1 end *
                round(t.discount_cents::numeric * (select coalesce(sum(l.amount_cents) filter (where l.taxable), 0) from transaction_lines l where l.transaction_id = t.id)
                      / nullif(t.subtotal_cents, 0)))::bigint as taxable_cents,
            sum(case when t.type in ('credit_memo','refund_receipt') then -t.tax_cents else t.tax_cents end)::bigint as tax_cents
     from transactions t left join tax_rates r on r.id = t.tax_rate_id
     where t.company_id = $1 and t.status = 'posted' and t.type in ('invoice','sales_receipt','credit_memo','refund_receipt')
       and t.txn_date between $2 and $3 and t.tax_rate_id is not null
     group by r.id order by name`,
    [companyId, from, to],
  );
  const payments = await query<{ id: string; txn_date: string; total_cents: number; memo: string | null; account: string }>(
    `select t.id, t.txn_date, t.total_cents, t.memo, a.name as account from transactions t join accounts a on a.id = t.account_id
     where t.company_id = $1 and t.type = 'sales_tax_payment' and t.status = 'posted' and t.txn_date between $2 and $3 order by t.txn_date`,
    [companyId, from, to],
  );
  const owed = await query<{ start: number; end_: number }>(
    `select coalesce(-sum(e.debit_cents - e.credit_cents) filter (where e.entry_date < $2), 0)::bigint as start,
            coalesce(-sum(e.debit_cents - e.credit_cents) filter (where e.entry_date <= $3), 0)::bigint as end_
     from ledger_entries e join accounts a on a.id = e.account_id where e.company_id = $1 and a.system_role = 'sales_tax_payable'`,
    [companyId, from, to],
  );
  return {
    byRate,
    taxCollected: byRate.reduce((s, r) => s + r.tax_cents, 0),
    payments,
    paid: payments.reduce((s, p) => s + p.total_cents, 0),
    owedStart: owed[0].start,
    owedEnd: owed[0].end_,
  };
}

// ------------------------------------------------------------------ 1099

/**
 * Cash paid to 1099 vendors in a calendar year from bank accounts (card
 * payments are reported by the card companies, so they're left out).
 */
export async function vendor1099(companyId: string, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = await query<{ id: string; name: string; tax_id: string | null; paid_cents: number }>(
    `select c.id, c.display_name as name, c.tax_id, coalesce(sum(t.total_cents), 0)::bigint as paid_cents
     from contacts c
     join transactions t on t.contact_id = c.id and t.status = 'posted' and t.txn_date between $2 and $3
       and t.type in ('bill_payment','expense','check')
     join accounts a on a.id = t.account_id and a.type = 'bank'
     where c.company_id = $1 and c.kind = 'vendor' and c.track_1099
     group by c.id order by lower(c.display_name)`,
    [companyId, from, to],
  );
  // The 1099-NEC/MISC reporting threshold rose from $600 to $2,000 for payments made from 2026.
  const thresholdCents = year >= 2026 ? 200000 : 60000;
  return { rows, thresholdCents };
}

