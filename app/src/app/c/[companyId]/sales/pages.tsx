import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { getSalesDoc } from "@/lib/queries";
import { loadSalesFormData } from "./load";
import { SalesForm, type SalesKind } from "./sales-form";

// Shared page bodies for the four sales forms; each route file is a one-liner.

type NewProps = { params: Promise<{ companyId: string }>; searchParams: Promise<{ customer?: string; saved?: string }> };
type EditProps = { params: Promise<{ companyId: string; id: string }>; searchParams: Promise<{ saved?: string }> };

const NOUN: Record<SalesKind, string> = { invoice: "Invoice", sales_receipt: "Sales receipt", credit_memo: "Credit memo", refund_receipt: "Refund" };

function Saved({ text }: { text: string }) {
  return (
    <p role="status" className="mb-4 rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
      {text}
    </p>
  );
}

export function newSalesPage(kind: SalesKind) {
  return async function NewSalesPage({ params, searchParams }: NewProps) {
    const { companyId } = await params;
    const { customer, saved } = await searchParams;
    await requireCompany(companyId, "standard");
    const data = await loadSalesFormData(companyId, kind);
    return (
      <>
        {saved !== undefined && <Saved text={`${NOUN[kind]} ${saved} saved.`} />}
        <SalesForm key={saved ?? "new"} kind={kind} companyId={companyId} {...data} initial={null} presetCustomerId={customer} />
      </>
    );
  };
}

export function editSalesPage(kind: SalesKind) {
  return async function EditSalesPage({ params, searchParams }: EditProps) {
    const { companyId, id } = await params;
    const { saved } = await searchParams;
    await requireCompany(companyId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const [doc, data] = await Promise.all([getSalesDoc(companyId, id, kind), loadSalesFormData(companyId, kind)]);
    if (!doc) notFound();
    return (
      <>
        {saved && <Saved text={`${NOUN[kind]} ${doc.number ?? ""} saved.`} />}
        <SalesForm key={doc.updated_at} kind={kind} companyId={companyId} {...data} initial={doc} />
      </>
    );
  };
}
