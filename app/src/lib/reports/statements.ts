import "server-only";
import { query } from "@/db";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/coa";
import { addDays, fiscalYearStart } from "@/lib/dates";
import { ASSET_TYPES, LIABILITY_TYPES, PNL_TYPES, accountTotals, ledgerSql, natural, type Basis } from "./core";
import { treeOrder } from "./pnl";

export interface BsLine {
  accountId: string | null; // null for computed lines (retained earnings, net income)
  name: string;
  depth: number;
  amount: number;
}
export interface BsGroup {
  title: string;
  lines: BsLine[];
  total: number;
}
export interface BalanceSheet {
  asOf: string;
  basis: Basis;
  assets: BsGroup[];
  totalAssets: number;
  liabilities: BsGroup[];
  totalLiabilities: number;
  equity: BsGroup;
  totalEquity: number;
  /** should always be 0; shown if not, so a problem can't hide */
  outOfBalance: number;
}

const groupTitle = (t: AccountType) => ACCOUNT_TYPE_LABELS[t].replace(" (A/R)", "").replace(" (A/P)", "");

export async function balanceSheet(companyId: string, asOf: string, basis: Basis, fyStartMonth: number): Promise<BalanceSheet> {
  const all = new Map((await query<{ id: string; parent_id: string | null }>("select id, parent_id from accounts where company_id = $1", [companyId])).map((a) => [a.id, a.parent_id]));
  const sheet = await accountTotals(companyId, basis, null, asOf, [...ASSET_TYPES, ...LIABILITY_TYPES, "equity"]);
  // Profit before this fiscal year rolls into retained earnings; this year's profit shows as net income.
  const fy = fiscalYearStart(asOf, fyStartMonth);
  const pnlBefore = await accountTotals(companyId, basis, null, addDays(fy, -1), PNL_TYPES);
  const pnlThisYear = await accountTotals(companyId, basis, fy, asOf, PNL_TYPES);
  const profit = (rows: typeof pnlBefore) => rows.reduce((s, r) => s + (["income", "other_income"].includes(r.type) ? r.amount : -r.amount), 0);

  const groups = (types: AccountType[]) =>
    types
      .map((t) => {
        const rows = treeOrder(
          sheet.filter((r) => r.type === t),
          all,
        );
        const lines = rows.map((r) => ({ accountId: r.id, name: r.name, depth: r.depth, amount: r.amount }));
        return { title: groupTitle(t), lines, total: lines.reduce((s, l) => s + l.amount, 0) };
      })
      .filter((g) => g.lines.length > 0);

  const assets = groups(ASSET_TYPES);
  const liabilities = groups(LIABILITY_TYPES);
  const eqRows = treeOrder(
    sheet.filter((r) => r.type === "equity"),
    all,
  );
  const retainedFromLedger = eqRows.find((r) => r.name === "Retained Earnings");
  const eqLines: BsLine[] = eqRows.filter((r) => r !== retainedFromLedger).map((r) => ({ accountId: r.id, name: r.name, depth: r.depth, amount: r.amount }));
  eqLines.push({ accountId: retainedFromLedger?.id ?? null, name: "Retained Earnings", depth: 0, amount: profit(pnlBefore) + (retainedFromLedger?.amount ?? 0) });
  eqLines.push({ accountId: null, name: "Net Income", depth: 0, amount: profit(pnlThisYear) });
  const equity = { title: "Equity", lines: eqLines, total: eqLines.reduce((s, l) => s + l.amount, 0) };

  const totalAssets = assets.reduce((s, g) => s + g.total, 0);
  const totalLiabilities = liabilities.reduce((s, g) => s + g.total, 0);
  return {
    asOf,
    basis,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity: equity.total,
    outOfBalance: totalAssets - totalLiabilities - equity.total,
  };
}

// ------------------------------------------------------------------ aging

export interface AgingRow {
  contactId: string;
  name: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d91: number;
  total: number;
}
export interface AgingDetail {
  id: string;
  type: string;
  number: string | null;
  txn_date: string;
  due_date: string | null;
  contact: string;
  contact_id: string;
  days: number;
  open: number;
}

/**
 * Open balances as of a date: invoices (or bills) less payments dated on or
 * before it, plus unapplied payments and credits as negatives in Current.
 */
export async function aging(companyId: string, side: "ar" | "ap", asOf: string) {
  const doc = side === "ar" ? "invoice" : "bill";
  const pay = side === "ar" ? "payment" : "bill_payment";
  const credit = side === "ar" ? "credit_memo" : "vendor_credit";
  const detail = await query<AgingDetail>(
    `select t.id, t.type, t.number, t.txn_date, t.due_date, c.display_name as contact, c.id as contact_id,
            greatest($2::date - coalesce(t.due_date, t.txn_date), 0) as days,
            case
              when t.type = $3 then t.total_cents - coalesce((select sum(pa.amount_cents) from payment_applications pa join transactions p on p.id = pa.source_txn_id
                                                               where pa.target_txn_id = t.id and p.txn_date <= $2), 0)
              when t.type = $4 then -t.balance_cents
              else -t.total_cents end::bigint as open
     from transactions t join contacts c on c.id = t.contact_id
     where t.company_id = $1 and t.status = 'posted' and t.txn_date <= $2 and t.type in ($3, $4, $5)
       and (t.type <> $4 or t.balance_cents > 0)
     order by lower(c.display_name), t.due_date nulls last, t.txn_date`,
    [companyId, asOf, doc, pay, credit],
  );
  const open = detail.filter((d) => d.open !== 0);
  const byContact = new Map<string, AgingRow>();
  for (const d of open) {
    const r = byContact.get(d.contact_id) ?? { contactId: d.contact_id, name: d.contact, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91: 0, total: 0 };
    const bucket = d.open < 0 || d.type !== doc || d.days === 0 ? "current" : d.days <= 30 ? "d1_30" : d.days <= 60 ? "d31_60" : d.days <= 90 ? "d61_90" : "d91";
    r[bucket] += d.open;
    r.total += d.open;
    byContact.set(d.contact_id, r);
  }
  const rows = [...byContact.values()].filter((r) => r.total !== 0 || r.current !== 0);
  const totals = rows.reduce(
    (t, r) => ({ current: t.current + r.current, d1_30: t.d1_30 + r.d1_30, d31_60: t.d31_60 + r.d31_60, d61_90: t.d61_90 + r.d61_90, d91: t.d91 + r.d91, total: t.total + r.total }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91: 0, total: 0 },
  );
  return { rows, totals, detail: open };
}

// ------------------------------------------------------------------ general ledger

export interface GlAccount {
  id: string;
  name: string;
  type: AccountType;
  opening: number;
  rows: { transaction_id: string; type: string; number: string | null; entry_date: string; contact: string | null; memo: string | null; amount: number; balance: number }[];
  closing: number;
}

export async function generalLedger(companyId: string, from: string, to: string, basis: Basis, accountId?: string | null): Promise<GlAccount[]> {
  const rows = await query<{
    account_id: string;
    name: string;
    type: AccountType;
    transaction_id: string;
    txn_type: string;
    number: string | null;
    entry_date: string;
    contact: string | null;
    memo: string | null;
    net: number;
  }>(
    `select a.id as account_id, a.name, a.type, l.transaction_id, t.type as txn_type, t.number, l.entry_date, c.display_name as contact, t.memo, l.net
     from (${ledgerSql(basis)}) l join accounts a on a.id = l.account_id join transactions t on t.id = l.transaction_id
     left join contacts c on c.id = coalesce(l.contact_id, t.contact_id)
     where l.entry_date between $2 and $3 and ($4::uuid is null or a.id = $4) and l.net <> 0
     order by a.number nulls last, lower(a.name), l.entry_date, t.created_at`,
    [companyId, from, to, accountId ?? null],
  );
  const opening = await query<{ id: string; net: number }>(
    `select l.account_id as id, sum(l.net)::bigint as net from (${ledgerSql(basis)}) l
     join accounts a on a.id = l.account_id
     where l.entry_date < $2 and a.type <> all($3::text[]) and ($4::uuid is null or a.id = $4)
     group by l.account_id`,
    [companyId, from, PNL_TYPES, accountId ?? null],
  );
  const openMap = new Map(opening.map((o) => [o.id, o.net]));
  const out = new Map<string, GlAccount>();
  for (const r of rows) {
    let g = out.get(r.account_id);
    if (!g) {
      const o = natural(r.type, openMap.get(r.account_id) ?? 0);
      g = { id: r.account_id, name: r.name, type: r.type, opening: o, rows: [], closing: o };
      out.set(r.account_id, g);
    }
    const amt = natural(r.type, r.net);
    g.closing += amt;
    g.rows.push({ transaction_id: r.transaction_id, type: r.txn_type, number: r.number, entry_date: r.entry_date, contact: r.contact, memo: r.memo, amount: amt, balance: g.closing });
  }
  return [...out.values()];
}
