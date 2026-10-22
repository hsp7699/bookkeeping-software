import { requireCompany } from "@/lib/authz";
import { InvoiceForm } from "../invoice-form";
import { loadInvoiceFormData } from "../load";

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ customer?: string; saved?: string }>;
}) {
  const { companyId } = await params;
  const { customer, saved } = await searchParams;
  await requireCompany(companyId, "standard");
  const data = await loadInvoiceFormData(companyId);
  return (
    <>
      {saved && (
        <p role="status" className="mb-4 rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
          Invoice {saved} saved.
        </p>
      )}
      <InvoiceForm key={saved ?? "new"} companyId={companyId} {...data} initial={null} presetCustomerId={customer} />
    </>
  );
}
