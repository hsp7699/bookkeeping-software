import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { getInvoice } from "@/lib/queries";
import { InvoiceForm } from "../invoice-form";
import { loadInvoiceFormData } from "../load";

export default async function EditInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { companyId, id } = await params;
  const { saved } = await searchParams;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [invoice, data] = await Promise.all([getInvoice(companyId, id), loadInvoiceFormData(companyId)]);
  if (!invoice) notFound();
  return (
    <>
      {saved && (
        <p role="status" className="mb-4 rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
          Invoice {invoice.number} saved.
        </p>
      )}
      <InvoiceForm key={invoice.updated_at} companyId={companyId} {...data} initial={invoice} />
    </>
  );
}
