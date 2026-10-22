import { Repeat } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { companyToday } from "@/lib/queries";
import { RecurringTable, type RecurringRow } from "./recurring-table";

export default async function RecurringPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const [today, rows] = await Promise.all([
    companyToday(companyId),
    query<RecurringRow>(
      `select r.id, r.name, r.txn_type, r.mode, r.interval_unit, r.interval_count, r.day_of_month, r.next_date::text, r.end_date::text, r.auto_send, r.active,
              r.last_error, r.last_run_at, r.template->>'memo' as memo,
              c.display_name as contact,
              coalesce((select sum(coalesce((l->>'amountCents')::bigint, 0)) from jsonb_array_elements(r.template->'lines') l
                        where coalesce(l->>'side', 'debit') = 'debit'), 0)::bigint
                + coalesce((r.template->>'amountCents')::bigint, 0) as amount_cents,
              (select count(*) from transactions t where t.recurring_template_id = r.id)::int as created_count
       from recurring_templates r left join contacts c on c.id = (r.template->>'contactId')::uuid
       where r.company_id = $1 order by r.active desc, r.next_date nulls last, lower(r.name)`,
      [companyId],
    ),
  ]);
  const due = rows.filter((r) => r.active && r.mode === "reminder" && r.next_date && r.next_date <= today).length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Recurring transactions</h1>
        <p className="mt-1 text-text-muted">To add one, open a saved invoice, expense, bill, journal entry or transfer and choose More, then Make recurring.</p>
      </div>
      {due > 0 && (
        <p role="status" className="rounded-md bg-warning-soft px-4 py-3 text-on-warning-soft">
          {due === 1 ? "1 reminder is" : `${due} reminders are`} ready. Use Create now to add {due === 1 ? "it" : "them"} to your books.
        </p>
      )}
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Repeat} title="Nothing repeats yet" body="Rent, a monthly retainer, a subscription: set it up once and it's created on schedule, or you're reminded to create it." />
        ) : (
          <RecurringTable companyId={companyId} rows={rows} today={today} />
        )}
      </Card>
    </div>
  );
}
