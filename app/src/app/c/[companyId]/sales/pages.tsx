import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { one } from "@/db";
import { formatCents } from "@/lib/money";
import { getSalesDoc } from "@/lib/queries";
import { loadSalesFormData } from "./load";
import { SalesForm, type SalesKind, type SalesPrefill } from "./sales-form";

/**
 * An invoice made from an estimate. If part of the estimate is already invoiced
 * (progress invoicing), the lines are scaled to what's left; edit them as needed.
 */
async function prefillFromEstimate(companyId: string, estimateId: string): Promise<SalesPrefill | null> {
  if (!/^[0-9a-f-]{36}$/i.test(estimateId)) return null;
  const est = await getSalesDoc(companyId, estimateId, "estimate");
  if (!est) return null;
  const done = (await one<{ s: number }>("select coalesce(sum(total_cents), 0)::bigint as s from transactions where linked_from_id = $1 and status = 'posted'", [estimateId]))!.s;
  const left = Math.max(est.total_cents - done, 0);
  const ratio = est.total_cents ? left / est.total_cents : 1;
  const scale = (c: number) => Math.round(c * ratio);
  return {
    contactId: est.contact_id,
    linkedFromId: est.id,
    taxRateId: est.tax_rate_id,
    discountCents: scale(est.discount_cents),
    memo: est.memo,
    lines: est.lines.map((l) =>
      ratio === 1
        ? l
        : { ...l, qty: 1, rate_cents: scale(l.amount_cents), amount_cents: scale(l.amount_cents), description: `${l.description ?? ""}${l.description ? " · " : ""}${Math.round(ratio * 100)}% of estimate` },
    ),
    note: done
      ? `From estimate ${est.number}: ${formatCents(done)} of ${formatCents(est.total_cents)} is already invoiced, so these lines cover the remaining ${formatCents(left)}. Change amounts to bill less.`
      : `From estimate ${est.number}. Change any line before saving; the estimate closes once its total is invoiced.`,
  };
}

// Shared page bodies for the four sales forms; each route file is a one-liner.

type NewProps = { params: Promise<{ companyId: string }>; searchParams: Promise<{ customer?: string; saved?: string; fromEstimate?: string }> };
type EditProps = { params: Promise<{ companyId: string; id: string }>; searchParams: Promise<{ saved?: string }> };

const NOUN: Record<SalesKind, string> = { invoice: "Invoice", sales_receipt: "Sales receipt", credit_memo: "Credit memo", refund_receipt: "Refund", estimate: "Estimate" };

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
    const { customer, saved, fromEstimate } = await searchParams;
    await requireCompany(companyId, "standard");
    const [data, prefill] = await Promise.all([loadSalesFormData(companyId, kind), kind === "invoice" && fromEstimate ? prefillFromEstimate(companyId, fromEstimate) : null]);
    return (
      <>
        {saved !== undefined && <Saved text={`${NOUN[kind]} ${saved} saved.`} />}
        <SalesForm key={saved ?? "new"} kind={kind} companyId={companyId} {...data} initial={null} presetCustomerId={customer} prefill={prefill} />
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
