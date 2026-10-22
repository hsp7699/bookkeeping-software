import Link from "next/link";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { StartForm, type AccountChoice } from "./start-form";

export default async function ReconcilePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId, "standard");
  const [accounts, history] = await Promise.all([
    query<AccountChoice>(
      `select a.id, a.name, a.type,
              (select r.statement_date from reconciliations r where r.account_id = a.id and r.status = 'completed' order by r.statement_date desc limit 1) as last_date,
              coalesce((select r.ending_balance_cents from reconciliations r where r.account_id = a.id and r.status = 'completed' order by r.statement_date desc limit 1), 0) as beginning_cents,
              (case when a.type = 'credit_card' then -1 else 1 end *
                coalesce((select sum(e.debit_cents - e.credit_cents) from ledger_entries e where e.account_id = a.id and e.reconcile_status = 'reconciled'), 0))::bigint as reconciled_now_cents,
              (select r.id from reconciliations r where r.account_id = a.id and r.status = 'in_progress') as in_progress
       from accounts a where a.company_id = $1 and a.active and a.type in ('bank','credit_card') order by a.type, lower(a.name)`,
      [companyId],
    ),
    query<{ id: string; account: string; statement_date: string; ending_balance_cents: number; status: string; completed_at: Date | null; user_name: string | null }>(
      `select r.id, a.name as account, r.statement_date, r.ending_balance_cents, r.status, r.completed_at, u.name as user_name
       from reconciliations r join accounts a on a.id = r.account_id left join users u on u.id = r.completed_by
       where r.company_id = $1 order by r.statement_date desc, r.created_at desc limit 100`,
      [companyId],
    ),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Reconcile</h1>
      <Card className="p-6">
        <h2 className="mb-1 text-lg font-semibold">Reconcile an account</h2>
        <p className="mb-4 text-text-muted">Grab your latest bank or card statement. You&apos;ll tick off everything on it until the difference is zero.</p>
        <StartForm companyId={companyId} accounts={accounts} />
      </Card>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">History</h2>
        <Card>
          {history.length === 0 ? (
            <p className="p-8 text-center text-text-muted">No reconciliations yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Statement date</Th>
                  <Th>Status</Th>
                  <Th>By</Th>
                  <Th numeric>Ending balance</Th>
                  <Th>
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <Tr key={h.id}>
                    <Td>{h.account}</Td>
                    <Td>{formatDate(h.statement_date)}</Td>
                    <Td>{h.status === "completed" ? "Reconciled" : h.status === "undone" ? "Undone" : "In progress"}</Td>
                    <Td>{h.user_name}</Td>
                    <Td numeric>{formatCents(h.ending_balance_cents)}</Td>
                    <Td className="text-right">
                      <Link className="text-accent hover:underline" href={`/c/${companyId}/reconcile/${h.id}`}>
                        {h.status === "in_progress" ? "Resume" : "View report"}
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
