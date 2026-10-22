import { notFound } from "next/navigation";
import { one } from "@/db";
import { requireCompany } from "@/lib/authz";
import { companyToday, listAccountsByType, listCustomerOptions } from "@/lib/queries";
import { PaymentForm, type PaymentDetail } from "../payment-form";

export default async function EditPaymentPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [payment, today, customers, accounts] = await Promise.all([
    one<PaymentDetail>(
      `select t.id, t.contact_id, t.txn_date, t.account_id, t.payment_method, t.number, t.total_cents, t.memo, t.status, t.updated_at::text as updated_at,
              coalesce((select json_agg(json_build_object('txn_id', a.target_txn_id, 'amount_cents', a.amount_cents))
                        from payment_applications a where a.source_txn_id = t.id), '[]') as applications
       from transactions t where t.company_id = $1 and t.id = $2 and t.type = 'payment'`,
      [companyId, id],
    ),
    companyToday(companyId),
    listCustomerOptions(companyId),
    listAccountsByType(companyId, ["bank", "other_current_asset"]),
  ]);
  if (!payment) notFound();
  const depositAccounts = accounts
    .filter((a) => a.type === "bank" || a.system_role === "undeposited_funds")
    .sort((a, b) => Number(b.system_role === "undeposited_funds") - Number(a.system_role === "undeposited_funds"));
  return <PaymentForm key={payment.updated_at} companyId={companyId} today={today} customers={customers} depositAccounts={depositAccounts} initial={payment} />;
}
