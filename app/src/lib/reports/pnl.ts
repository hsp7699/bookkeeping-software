import "server-only";
import { query } from "@/db";
import type { AccountType } from "@/lib/coa";

export interface ReportRow {
  accountId: string;
  name: string;
  amountCents: number;
}

export interface ReportSection {
  key: string;
  title: string;
  rows: ReportRow[];
  totalCents: number;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  basis: "accrual" | "cash";
  income: ReportSection;
  cogs: ReportSection;
  grossProfitCents: number;
  expenses: ReportSection;
  netOperatingIncomeCents: number;
  otherIncome: ReportSection;
  otherExpense: ReportSection;
  netOtherIncomeCents: number;
  netIncomeCents: number;
}

const SECTIONS: { key: keyof Pick<ProfitAndLoss, "income" | "cogs" | "expenses" | "otherIncome" | "otherExpense">; type: AccountType; title: string; credit: boolean }[] = [
  { key: "income", type: "income", title: "Income", credit: true },
  { key: "cogs", type: "cost_of_goods_sold", title: "Cost of goods sold", credit: false },
  { key: "expenses", type: "expense", title: "Expenses", credit: false },
  { key: "otherIncome", type: "other_income", title: "Other income", credit: true },
  { key: "otherExpense", type: "other_expense", title: "Other expenses", credit: false },
];

/**
 * Cash basis: income and expense lines on invoices and bills count when they
 * are paid, in proportion (amount applied / document total), on the payment
 * date. Everything else (sales receipts, expenses, checks, JEs) is already cash.
 */
const CASH_SQL = `
  -- non-A/R, non-A/P transactions count as they are
  select e.account_id, e.debit_cents - e.credit_cents as net
  from ledger_entries e join transactions t on t.id = e.transaction_id
  where e.company_id = $1 and e.entry_date between $2 and $3 and t.type not in ('invoice','bill','credit_memo','vendor_credit','payment','bill_payment')
  union all
  -- invoices and bills: their P&L entries, scaled by what was paid in the period
  select e.account_id, round((e.debit_cents - e.credit_cents)::numeric * pa.amount_cents / nullif(doc.total_cents, 0))::bigint as net
  from payment_applications pa
  join transactions pay on pay.id = pa.source_txn_id
  join transactions doc on doc.id = pa.target_txn_id
  join ledger_entries e on e.transaction_id = doc.id
  where pa.company_id = $1 and pay.txn_date between $2 and $3 and pay.status = 'posted'
`;

export async function profitAndLoss(companyId: string, from: string, to: string, basis: "accrual" | "cash"): Promise<ProfitAndLoss> {
  const source =
    basis === "accrual"
      ? `select account_id, debit_cents - credit_cents as net from ledger_entries where company_id = $1 and entry_date between $2 and $3`
      : CASH_SQL;
  const rows = await query<{ id: string; name: string; type: AccountType; net: number }>(
    `select a.id, a.name, a.type, sum(s.net)::bigint as net
     from (${source}) s join accounts a on a.id = s.account_id
     where a.type in ('income','cost_of_goods_sold','expense','other_income','other_expense')
     group by a.id
     having sum(s.net) <> 0
     order by lower(a.name)`,
    [companyId, from, to],
  );

  const sections = Object.fromEntries(
    SECTIONS.map((s) => {
      const list = rows
        .filter((r) => r.type === s.type)
        .map((r) => ({ accountId: r.id, name: r.name, amountCents: s.credit ? -r.net : r.net }));
      return [s.key, { key: s.key, title: s.title, rows: list, totalCents: list.reduce((a, r) => a + r.amountCents, 0) }];
    }),
  ) as Record<(typeof SECTIONS)[number]["key"], ReportSection>;

  const gross = sections.income.totalCents - sections.cogs.totalCents;
  const operating = gross - sections.expenses.totalCents;
  const other = sections.otherIncome.totalCents - sections.otherExpense.totalCents;
  return {
    from,
    to,
    basis,
    ...sections,
    grossProfitCents: gross,
    netOperatingIncomeCents: operating,
    netOtherIncomeCents: other,
    netIncomeCents: operating + other,
  };
}
