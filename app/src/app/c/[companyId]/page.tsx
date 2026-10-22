import { FileText, Landmark } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/table";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { addDays, fiscalYearStart, monthEnd, monthStart } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { accountTotals, accountTotalsByMonth, monthsBetween, PNL_TYPES } from "@/lib/reports/core";
import { companyToday } from "@/lib/queries";
import { IncomeExpenseChart, type MonthPoint } from "./dashboard-chart";

const isIncome = (t: string) => t === "income" || t === "other_income";

function Tile({ label, value, sub, href }: { label: string; value: string; sub?: React.ReactNode; href?: string }) {
  const body = (
    <Card className={cn("flex h-full flex-col gap-1 p-4", href && "hover:border-accent")}>
      <p className="text-sm text-text-muted">{label}</p>
      <p className="num text-left text-xl font-bold">{value}</p>
      {sub && <p className="text-sm text-text-muted">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function Home({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId);
  const base = `/c/${companyId}`;
  const [today, company, anyTxn] = await Promise.all([
    companyToday(companyId),
    one<{ fiscal_year_start_month: number; accounting_method: "accrual" | "cash" }>("select fiscal_year_start_month, accounting_method from companies where id = $1", [companyId]),
    one("select 1 from transactions where company_id = $1 limit 1", [companyId]),
  ]);

  if (!anyTxn) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-bold">Home</h1>
        <Card>
          <EmptyState
            icon={FileText}
            title={`Welcome to ${ctx.companyName}`}
            body="Start with an invoice, or import your bank transactions. Everything you record lands in your books and reports right away."
            action={
              <>
                <Button asChild variant="primary">
                  <Link href={`${base}/invoices/new`}>Create an invoice</Link>
                </Button>
                <Button asChild>
                  <Link href={`${base}/banking`}>Import bank transactions</Link>
                </Button>
              </>
            }
          />
        </Card>
      </div>
    );
  }

  const basis = company!.accounting_method;
  const thisMonth = [monthStart(today), today] as const;
  const lastMonthStart = monthStart(addDays(monthStart(today), -1));
  const sixStart = (() => {
    const [y, m] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 6, 1)).toISOString().slice(0, 10);
  })();
  const fy = fiscalYearStart(today, company!.fiscal_year_start_month);

  const [banks, ar, ap, review, pnlThis, pnlLast, byMonth, ytdExpenses] = await Promise.all([
    query<{ id: string; name: string; type: string; balance: number; feed_id: string | null; to_review: number }>(
      `select a.id, a.name, a.type,
              (case when a.type = 'credit_card' then -1 else 1 end * coalesce(sum(e.debit_cents - e.credit_cents), 0))::bigint as balance,
              f.id as feed_id,
              coalesce((select count(*) from bank_feed_txns b where b.feed_account_id = f.id and b.status = 'for_review'), 0)::int as to_review
       from accounts a left join ledger_entries e on e.account_id = a.id and e.entry_date <= $2 left join bank_feed_accounts f on f.account_id = a.id
       where a.company_id = $1 and a.active and a.type in ('bank','credit_card') group by a.id, f.id order by a.type, lower(a.name)`,
      [companyId, today],
    ),
    one<{ open: number; overdue: number; overdue_count: number }>(
      `select coalesce(sum(balance_cents), 0)::bigint as open,
              coalesce(sum(balance_cents) filter (where due_date < $2), 0)::bigint as overdue,
              count(*) filter (where due_date < $2 and balance_cents > 0)::int as overdue_count
       from transactions where company_id = $1 and type = 'invoice' and status = 'posted'`,
      [companyId, today],
    ),
    one<{ open: number; due_soon: number }>(
      `select coalesce(sum(balance_cents), 0)::bigint as open,
              coalesce(sum(balance_cents) filter (where due_date <= $2::date + 7), 0)::bigint as due_soon
       from transactions where company_id = $1 and type = 'bill' and status = 'posted'`,
      [companyId, today],
    ),
    one<{ n: number }>("select count(*)::int as n from bank_feed_txns where company_id = $1 and status = 'for_review'", [companyId]),
    accountTotals(companyId, basis, thisMonth[0], thisMonth[1], PNL_TYPES),
    accountTotals(companyId, basis, lastMonthStart, monthEnd(lastMonthStart), PNL_TYPES),
    accountTotalsByMonth(companyId, basis, sixStart, today, PNL_TYPES),
    accountTotals(companyId, basis, fy, today, ["expense", "cost_of_goods_sold", "other_expense"]),
  ]);

  const net = (rows: { type: string; amount: number }[]) => rows.reduce((s, r) => s + (isIncome(r.type) ? r.amount : -r.amount), 0);
  const netThis = net(pnlThis);
  const netLast = net(pnlLast);
  const cash = banks.filter((b) => b.type === "bank").reduce((s, b) => s + b.balance, 0);

  const months = monthsBetween(sixStart, today);
  const chart: MonthPoint[] = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo - 1, 1));
    const rows = byMonth.filter((r) => r.month === m);
    return {
      month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      label: d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      income: rows.filter((r) => isIncome(r.type)).reduce((s, r) => s + r.amount, 0),
      expenses: rows.filter((r) => !isIncome(r.type)).reduce((s, r) => s + r.amount, 0),
    };
  });

  const sorted = ytdExpenses.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const top = sorted.slice(0, 5);
  const other = sorted.slice(5).reduce((s, r) => s + r.amount, 0);
  const cats = other > 0 ? [...top.map((r) => ({ name: r.name, amount: r.amount, id: r.id as string | null })), { name: "Everything else", amount: other, id: null }] : top.map((r) => ({ name: r.name, amount: r.amount, id: r.id as string | null }));
  const catMax = Math.max(...cats.map((c) => c.amount), 1);
  const ytdTotal = sorted.reduce((s, r) => s + r.amount, 0);

  const delta = netThis - netLast;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Home</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Cash in the bank" value={formatCents(cash)} sub={`${banks.filter((b) => b.type === "bank").length} bank accounts`} href={`${base}/accounts`} />
        <Tile
          label="Customers owe you"
          value={formatCents(ar!.open)}
          sub={ar!.overdue ? <span className="text-danger">{formatCents(ar!.overdue)} overdue ({ar!.overdue_count})</span> : "Nothing overdue"}
          href={`${base}/reports/ar-aging`}
        />
        <Tile label="You owe vendors" value={formatCents(ap!.open)} sub={ap!.due_soon ? `${formatCents(ap!.due_soon)} due within a week` : "Nothing due this week"} href={`${base}/bills/pay`} />
        <Tile
          label="Net income this month"
          value={formatCents(netThis)}
          sub={
            <>
              {delta >= 0 ? "▲" : "▼"} {formatCents(Math.abs(delta))} {delta >= 0 ? "more" : "less"} than all of last month
            </>
          }
          href={`${base}/reports/profit-and-loss?range=this_month`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-md font-semibold">Income and expenses</h2>
            <p className="text-sm text-text-muted">Last 6 months · {basis === "cash" ? "cash" : "accrual"} basis</p>
          </div>
          <IncomeExpenseChart data={chart} />
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-md font-semibold">Where the money goes</h2>
            <p className="text-sm text-text-muted">This fiscal year · {formatCents(ytdTotal)}</p>
          </div>
          {cats.length === 0 ? (
            <p className="py-8 text-center text-text-muted">No expenses yet this year.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {cats.map((c) => (
                <li key={c.name}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    {c.id ? (
                      <Link className="truncate hover:underline" href={`${base}/reports/transactions?account=${c.id}&from=${fy}&to=${today}&basis=${basis}`}>
                        {c.name}
                      </Link>
                    ) : (
                      <span className="truncate">{c.name}</span>
                    )}
                    <span className="num">{formatCents(c.amount)}</span>
                  </div>
                  <div className="h-2 rounded-r-[4px] bg-[var(--color-series-1)]" style={{ width: `${Math.max((c.amount / catMax) * 100, 1)}%` }} aria-hidden />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-md font-semibold">Bank accounts</h2>
          {review!.n > 0 && (
            <Link href={`${base}/banking`} className="text-sm font-medium text-accent hover:underline">
              {review!.n} bank {review!.n === 1 ? "transaction" : "transactions"} to review
            </Link>
          )}
        </div>
        {banks.length === 0 ? (
          <EmptyState icon={Landmark} title="No bank accounts" body="Add one in the chart of accounts." />
        ) : (
          <ul className="divide-y divide-border">
            {banks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-4 py-2">
                <Link href={`${base}/accounts/${b.id}`} className="hover:underline">
                  {b.name} <span className="text-sm text-text-muted">{b.type === "credit_card" ? "· owed" : ""}</span>
                </Link>
                <span className="flex items-center gap-4">
                  {b.to_review > 0 && (
                    <Link href={`${base}/banking?account=${b.feed_id}`} className="text-sm text-accent hover:underline">
                      {b.to_review} to review
                    </Link>
                  )}
                  <span className="num font-semibold">{formatCents(b.balance)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
