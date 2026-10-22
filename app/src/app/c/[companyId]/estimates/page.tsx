import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

const TONE: Record<string, [PillTone, string]> = { pending: ["open", "Pending"], accepted: ["partial", "Accepted"], rejected: ["voided", "Rejected"], closed: ["paid", "Closed"] };

export default async function EstimatesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const rows = await query<{ id: string; number: string | null; txn_date: string; expires_on: string | null; customer: string; total_cents: number; invoiced_cents: number; doc_status: string; expired: boolean }>(
    `select t.id, t.number, t.txn_date, t.expires_on, c.display_name as customer, t.total_cents, t.doc_status,
            coalesce((select sum(i.total_cents) from transactions i where i.linked_from_id = t.id and i.status = 'posted'), 0)::bigint as invoiced_cents,
            coalesce(t.expires_on < (select (now() at time zone timezone)::date from companies where id = $1), false) and t.doc_status = 'pending' as expired
     from transactions t join contacts c on c.id = t.contact_id
     where t.company_id = $1 and t.type = 'estimate' and t.status = 'posted' order by t.txn_date desc, t.number desc nulls last limit 500`,
    [companyId],
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Estimates</h1>
        <Button asChild variant="primary">
          <Link href={`/c/${companyId}/estimates/new`}>
            <Plus className="size-4" aria-hidden /> New estimate
          </Link>
        </Button>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No estimates yet" body="Quote a job, then turn it into an invoice, all at once or in parts as the work gets done." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>No.</Th>
                <Th>Customer</Th>
                <Th>Expires</Th>
                <Th>Status</Th>
                <Th numeric>Total</Th>
                <Th numeric>Invoiced</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [tone, label] = TONE[r.doc_status] ?? ["open", r.doc_status];
                return (
                  <Tr key={r.id}>
                    <Td>{formatDate(r.txn_date)}</Td>
                    <Td>
                      <Link className="font-medium text-accent hover:underline" href={`/c/${companyId}/estimates/${r.id}`}>
                        {r.number}
                      </Link>
                    </Td>
                    <Td>{r.customer}</Td>
                    <Td className={r.expired ? "text-danger" : undefined}>
                      {r.expires_on ? formatDate(r.expires_on) : ""}
                      {r.expired && " (expired)"}
                    </Td>
                    <Td>
                      <StatusPill tone={tone}>{label}</StatusPill>
                    </Td>
                    <Td numeric>{formatCents(r.total_cents)}</Td>
                    <Td numeric>{r.invoiced_cents ? formatCents(r.invoiced_cents) : ""}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
