import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { companyToday, listAccountsByType } from "@/lib/queries";
import { PayBillsForm, type OpenBill } from "./pay-bills-form";

export default async function PayBillsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ vendor?: string }> }) {
  const { companyId } = await params;
  const { vendor } = await searchParams;
  await requireCompany(companyId, "standard");
  const [today, accounts, bills] = await Promise.all([
    companyToday(companyId),
    listAccountsByType(companyId, ["bank", "credit_card"]),
    query<OpenBill>(
      `with today as (select (now() at time zone timezone)::date as d from companies where id = $1)
       select t.id, t.contact_id as vendor_id, c.display_name as vendor, t.number, t.txn_date, t.due_date, t.total_cents, t.balance_cents,
              coalesce(t.due_date < (select d from today), false) as overdue
       from transactions t join contacts c on c.id = t.contact_id
       where t.company_id = $1 and t.type = 'bill' and t.status = 'posted' and t.balance_cents > 0
         and ($2::uuid is null or t.contact_id = $2)
       order by t.due_date nulls last, lower(c.display_name)`,
      [companyId, vendor && /^[0-9a-f-]{36}$/i.test(vendor) ? vendor : null],
    ),
  ]);
  return <PayBillsForm companyId={companyId} today={today} bills={bills} accounts={accounts} />;
}
