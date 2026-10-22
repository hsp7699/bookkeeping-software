import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { listInvoices, type InvoiceListRow } from "@/lib/queries";

const FILTERS = [
  ["all", "All"],
  ["open", "Open"],
  ["overdue", "Overdue"],
  ["paid", "Paid"],
] as const;

function Status({ r }: { r: InvoiceListRow }) {
  if (r.status === "voided") return <StatusPill tone="voided">Voided</StatusPill>;
  if (r.balance_cents === 0) return <StatusPill tone="paid">Paid</StatusPill>;
  if (r.days_overdue) return <StatusPill tone="overdue">Overdue {r.days_overdue} {r.days_overdue === 1 ? "day" : "days"}</StatusPill>;
  if (r.balance_cents < r.total_cents) return <StatusPill tone="partial">Partially paid</StatusPill>;
  return <StatusPill tone="open">Open</StatusPill>;
}

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { companyId } = await params;
  const { status: s } = await searchParams;
  await requireCompany(companyId);
  const status = (FILTERS.find(([k]) => k === s)?.[0] ?? "all") as (typeof FILTERS)[number][0];
  const rows = await listInvoices(companyId, status);
  const base = `/c/${companyId}/invoices`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Invoices</h1>
        <Button asChild variant="primary">
          <Link href={`${base}/new`}>
            <Plus className="size-4" aria-hidden /> New invoice
          </Link>
        </Button>
      </div>
      <nav aria-label="Filter invoices" className="flex gap-1">
        {FILTERS.map(([k, label]) => (
          <Link
            key={k}
            href={k === "all" ? base : `${base}?status=${k}`}
            aria-current={status === k ? "page" : undefined}
            className={cn("rounded-pill px-3 py-1 text-sm font-medium", status === k ? "bg-accent-soft text-on-accent-soft" : "text-text-muted hover:bg-row-hover")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          status === "all" ? (
            <EmptyState
              icon={FileText}
              title="No invoices yet"
              body="Send an invoice and track it from open to paid."
              action={
                <Button asChild variant="primary">
                  <Link href={`${base}/new`}>Create invoice</Link>
                </Button>
              }
            />
          ) : (
            <p className="p-8 text-center text-text-muted">No invoices match this filter.</p>
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>No.</Th>
                <Th>Customer</Th>
                <Th>Due date</Th>
                <Th>Status</Th>
                <Th numeric>Amount</Th>
                <Th numeric>Open balance</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDate(r.txn_date)}</Td>
                  <Td>
                    <Link href={`${base}/${r.id}`} className="font-medium text-accent hover:underline">
                      {r.number ?? "—"}
                    </Link>
                  </Td>
                  <Td>{r.customer}</Td>
                  <Td>{r.due_date ? formatDate(r.due_date) : ""}</Td>
                  <Td>
                    <Status r={r} />
                  </Td>
                  <Td numeric className={r.status === "voided" ? "text-text-muted line-through" : undefined}>
                    {formatCents(r.total_cents)}
                  </Td>
                  <Td numeric>{formatCents(r.balance_cents)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
