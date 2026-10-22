import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { workspace } from "@/lib/reconcile";
import { TXN_LABEL, txnHref } from "@/lib/routes";
import { UndoButton } from "./undo-button";
import { Workspace } from "./workspace";

export default async function ReconPage({ params, searchParams }: { params: Promise<{ companyId: string; id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { companyId, id } = await params;
  const { done } = await searchParams;
  await requireCompany(companyId, "standard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const w = await workspace(companyId, id);
  if (!w) notFound();
  const { recon, account, entries } = w;
  if (recon.status === "in_progress") {
    return (
      <Workspace
        key={`${recon.statement_date}-${recon.ending_balance_cents}`}
        companyId={companyId}
        reconId={id}
        accountName={account.name}
        accountType={account.type}
        statementDate={recon.statement_date}
        beginningCents={recon.beginning_balance_cents}
        endingCents={recon.ending_balance_cents}
        entries={entries}
      />
    );
  }

  // Reconciliation report
  const ins = entries.filter((e) => e.amount_cents > 0);
  const outs = entries.filter((e) => e.amount_cents < 0);
  const sum = (l: typeof entries) => l.reduce((t, e) => t + e.amount_cents, 0);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/c/${companyId}/reconcile`} className="text-sm text-accent hover:underline">
          ← Reconcile
        </Link>
        <h1 className="mt-1 text-xl font-bold">
          {account.name} reconciliation · {formatDate(recon.statement_date)}
        </h1>
        {recon.status === "undone" && <p className="mt-1 text-warning">This reconciliation was undone.</p>}
      </div>
      {done && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
          Reconciled. These transactions are now locked so the next statement starts from the right balance.
        </p>
      )}
      <Card className="grid gap-4 p-6 sm:grid-cols-4">
        <div>
          <p className="text-sm text-text-muted">Beginning balance</p>
          <p className="num text-left text-lg">{formatCents(recon.beginning_balance_cents)}</p>
        </div>
        <div>
          <p className="text-sm text-text-muted">{ins.length} increases</p>
          <p className="num text-left text-lg">{formatCents(sum(ins))}</p>
        </div>
        <div>
          <p className="text-sm text-text-muted">{outs.length} decreases</p>
          <p className="num text-left text-lg">{formatCents(sum(outs))}</p>
        </div>
        <div>
          <p className="text-sm text-text-muted">Statement ending balance</p>
          <p className="num text-left text-lg font-semibold">{formatCents(recon.ending_balance_cents)}</p>
        </div>
      </Card>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Ref no.</Th>
              <Th>Payee</Th>
              <Th numeric>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <Tr key={e.id}>
                <Td>{formatDate(e.entry_date)}</Td>
                <Td>
                  <Link className="text-accent hover:underline" href={txnHref(companyId, e.type, e.transaction_id)}>
                    {TXN_LABEL[e.type]}
                  </Link>
                </Td>
                <Td>{e.number}</Td>
                <Td>{e.payee}</Td>
                <Td numeric>{formatCents(e.amount_cents)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {recon.status === "completed" && <UndoButton companyId={companyId} reconId={id} />}
    </div>
  );
}
