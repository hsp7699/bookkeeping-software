import { Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TXN_LABEL, txnHref } from "@/lib/routes";

const TYPES = [
  ["all", "All"],
  ["expense", "Expenses"],
  ["check", "Checks"],
  ["bill", "Bills"],
  ["bill_payment", "Bill payments"],
  ["vendor_credit", "Vendor credits"],
  ["credit_card_credit", "Card credits"],
  ["purchase_order", "Purchase orders"],
] as const;

export default async function ExpensesPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ type?: string }> }) {
  const { companyId } = await params;
  const { type: t } = await searchParams;
  await requireCompany(companyId);
  const type = TYPES.find(([k]) => k === t)?.[0] ?? "all";
  const rows = await query<{
    id: string;
    type: string;
    number: string | null;
    txn_date: string;
    payee: string | null;
    category: string | null;
    account: string | null;
    total_cents: number;
    balance_cents: number;
    status: string;
    doc_status: string | null;
    overdue_days: number | null;
  }>(
    `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
     select t.id, t.type, t.number, t.txn_date, c.display_name as payee,
            case when (select count(*) from transaction_lines l where l.transaction_id = t.id) > 1 then '-Split-'
                 else (select a.name from transaction_lines l join accounts a on a.id = l.account_id where l.transaction_id = t.id limit 1) end as category,
            pa.name as account, t.total_cents, t.balance_cents, t.status, t.doc_status,
            case when t.type = 'bill' and t.balance_cents > 0 and t.due_date < (select d from today) then (select d from today) - t.due_date end as overdue_days
     from transactions t left join contacts c on c.id = t.contact_id left join accounts pa on pa.id = t.account_id
     where t.company_id = $1 and t.type in ('expense','check','bill','bill_payment','vendor_credit','credit_card_credit','purchase_order')
       and (($2 = 'all' and t.type <> 'purchase_order') or t.type = $2)
     order by t.txn_date desc, t.created_at desc limit 500`,
    [companyId, type],
  );
  const base = `/c/${companyId}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Expenses</h1>
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`${base}/bills/pay`}>Pay bills</Link>
          </Button>
          <Button asChild>
            <Link href={`${base}/bills/new`}>New bill</Link>
          </Button>
          <Button asChild variant="primary">
            <Link href={`${base}/expenses/new`}>
              <Plus className="size-4" aria-hidden /> New expense
            </Link>
          </Button>
        </div>
      </div>
      <nav aria-label="Filter by type" className="flex flex-wrap gap-1">
        {TYPES.map(([k, label]) => (
          <Link
            key={k}
            href={k === "all" ? `${base}/expenses` : `${base}/expenses?type=${k}`}
            aria-current={type === k ? "page" : undefined}
            className={cn("rounded-pill px-3 py-1 text-sm font-medium", type === k ? "bg-accent-soft text-on-accent-soft" : "text-text-muted hover:bg-row-hover")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses yet" body="Record what you spend: card purchases, checks and bills to pay later." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>No.</Th>
                <Th>Payee</Th>
                <Th>Category</Th>
                <Th>Paid from</Th>
                <Th>Status</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDate(r.txn_date)}</Td>
                  <Td>
                    <Link className="text-accent hover:underline" href={txnHref(companyId, r.type, r.id)}>
                      {TXN_LABEL[r.type]}
                    </Link>
                  </Td>
                  <Td>{r.number}</Td>
                  <Td>{r.payee}</Td>
                  <Td className="text-text-muted">{r.category}</Td>
                  <Td className="text-text-muted">{r.type === "bill" || r.type === "vendor_credit" ? "" : r.account}</Td>
                  <Td>
                    {r.status === "voided" ? (
                      <StatusPill tone="voided">Voided</StatusPill>
                    ) : r.type === "purchase_order" ? (
                      r.doc_status === "closed" ? <StatusPill tone="paid">Closed</StatusPill> : <StatusPill tone="open">Open</StatusPill>
                    ) : r.type === "bill" ? (
                      r.balance_cents === 0 ? (
                        <StatusPill tone="paid">Paid</StatusPill>
                      ) : r.overdue_days ? (
                        <StatusPill tone="overdue">Overdue {r.overdue_days} {r.overdue_days === 1 ? "day" : "days"}</StatusPill>
                      ) : r.balance_cents < r.total_cents ? (
                        <StatusPill tone="partial">Partially paid</StatusPill>
                      ) : (
                        <StatusPill tone="open">Open</StatusPill>
                      )
                    ) : null}
                  </Td>
                  <Td numeric className={cn(r.status === "voided" && "text-text-muted line-through")}>
                    {formatCents(r.type === "vendor_credit" || r.type === "credit_card_credit" ? -r.total_cents : r.total_cents)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
