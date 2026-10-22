import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TXN_LABEL, txnHref } from "@/lib/routes";

const TYPES = [
  ["all", "All sales"],
  ["invoice", "Invoices"],
  ["payment", "Payments"],
  ["sales_receipt", "Sales receipts"],
  ["credit_memo", "Credit memos"],
  ["refund_receipt", "Refunds"],
] as const;

export default async function SalesPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ type?: string }> }) {
  const { companyId } = await params;
  const { type: t } = await searchParams;
  await requireCompany(companyId);
  const type = TYPES.find(([k]) => k === t)?.[0] ?? "all";
  const rows = await query<{
    id: string;
    type: string;
    number: string | null;
    txn_date: string;
    due_date: string | null;
    customer: string | null;
    total_cents: number;
    balance_cents: number;
    status: string;
    deposited: boolean;
    overdue_days: number | null;
  }>(
    `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
     select t.id, t.type, t.number, t.txn_date, t.due_date, c.display_name as customer, t.total_cents, t.balance_cents, t.status,
            exists(select 1 from deposit_items d where d.source_txn_id = t.id) as deposited,
            case when t.type = 'invoice' and t.balance_cents > 0 and t.due_date < (select d from today) then (select d from today) - t.due_date end as overdue_days
     from transactions t left join contacts c on c.id = t.contact_id
     where t.company_id = $1 and t.type in ('invoice','payment','sales_receipt','credit_memo','refund_receipt') and ($2 = 'all' or t.type = $2)
     order by t.txn_date desc, t.created_at desc limit 500`,
    [companyId, type],
  );
  const base = `/c/${companyId}`;
  function status(r: (typeof rows)[number]) {
    if (r.status === "voided") return <StatusPill tone="voided">Voided</StatusPill>;
    if (r.type === "invoice") {
      if (r.balance_cents === 0) return <StatusPill tone="paid">Paid</StatusPill>;
      if (r.overdue_days) return <StatusPill tone="overdue">Overdue {r.overdue_days} {r.overdue_days === 1 ? "day" : "days"}</StatusPill>;
      if (r.balance_cents < r.total_cents) return <StatusPill tone="partial">Partially paid</StatusPill>;
      return <StatusPill tone="open">Open</StatusPill>;
    }
    if (r.type === "payment" || r.type === "sales_receipt") return r.deposited ? <StatusPill tone="deposited">Deposited</StatusPill> : <StatusPill tone="draft">Not deposited</StatusPill>;
    if (r.type === "credit_memo") return <StatusPill tone="open">Unapplied</StatusPill>;
    return null;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Sales transactions</h1>
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`${base}/payments/new`}>Receive payment</Link>
          </Button>
          <Button asChild variant="primary">
            <Link href={`${base}/invoices/new`}>
              <Plus className="size-4" aria-hidden /> New invoice
            </Link>
          </Button>
        </div>
      </div>
      <nav aria-label="Filter by type" className="flex flex-wrap gap-1">
        {TYPES.map(([k, label]) => (
          <Link
            key={k}
            href={k === "all" ? `${base}/sales` : `${base}/sales?type=${k}`}
            aria-current={type === k ? "page" : undefined}
            className={cn("rounded-pill px-3 py-1 text-sm font-medium", type === k ? "bg-accent-soft text-on-accent-soft" : "text-text-muted hover:bg-row-hover")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-text-muted">No sales transactions yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>No.</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th numeric>Total</Th>
                <Th numeric>Balance</Th>
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
                  <Td>{r.customer}</Td>
                  <Td>{status(r)}</Td>
                  <Td numeric className={cn(r.status === "voided" && "text-text-muted line-through")}>
                    {formatCents(r.type === "credit_memo" || r.type === "refund_receipt" ? -r.total_cents : r.total_cents)}
                  </Td>
                  <Td numeric>{r.type === "invoice" ? formatCents(r.balance_cents) : ""}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
