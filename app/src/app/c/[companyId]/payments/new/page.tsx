import { requireCompany } from "@/lib/authz";
import { companyToday, listAccountsByType, listCustomerOptions } from "@/lib/queries";
import { PaymentForm } from "../payment-form";

export default async function NewPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ customer?: string; invoice?: string; saved?: string }>;
}) {
  const { companyId } = await params;
  const { customer, invoice, saved } = await searchParams;
  await requireCompany(companyId, "standard");
  const [today, customers, accounts] = await Promise.all([
    companyToday(companyId),
    listCustomerOptions(companyId),
    listAccountsByType(companyId, ["bank", "other_current_asset"]),
  ]);
  // Undeposited Funds first, then banks
  const depositAccounts = accounts
    .filter((a) => a.type === "bank" || a.system_role === "undeposited_funds")
    .sort((a, b) => (a.system_role === "undeposited_funds" ? -1 : b.system_role === "undeposited_funds" ? 1 : 0));
  return (
    <>
      {saved && (
        <p role="status" className="mb-4 rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
          Payment saved.
        </p>
      )}
      <PaymentForm
        key={saved ?? "new"}
        companyId={companyId}
        today={today}
        customers={customers}
        depositAccounts={depositAccounts}
        presetCustomerId={customer}
        presetInvoiceId={invoice}
      />
    </>
  );
}
