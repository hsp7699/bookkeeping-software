import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { companyToday, getPurchaseDoc, listAccountsByType, listCategoryAccounts, listContactOptions, listTerms, listTracking } from "@/lib/queries";
import { one } from "@/db";
import { formatCents } from "@/lib/money";
import { PurchaseForm, type PurchaseKind, type PurchasePrefill } from "./purchase-form";

type NewProps = { params: Promise<{ companyId: string }>; searchParams: Promise<{ vendor?: string; saved?: string; fromPo?: string }> };
type EditProps = { params: Promise<{ companyId: string; id: string }>; searchParams: Promise<{ saved?: string }> };

const NOUN: Record<PurchaseKind, string> = { expense: "Expense", check: "Check", bill: "Bill", vendor_credit: "Vendor credit", credit_card_credit: "Credit card credit", purchase_order: "Purchase order" };

/** A bill made from a purchase order: the PO's lines, less anything already billed. */
async function prefillFromPo(companyId: string, poId: string): Promise<PurchasePrefill | null> {
  if (!/^[0-9a-f-]{36}$/i.test(poId)) return null;
  const po = await getPurchaseDoc(companyId, poId, "purchase_order");
  if (!po || !po.contact_id) return null;
  const done = (await one<{ s: number }>("select coalesce(sum(total_cents), 0)::bigint as s from transactions where linked_from_id = $1 and status = 'posted'", [poId]))!.s;
  const ratio = po.total_cents ? Math.max(po.total_cents - done, 0) / po.total_cents : 1;
  return {
    contactId: po.contact_id,
    linkedFromId: po.id,
    memo: po.memo,
    lines: po.lines.map((l) => ({ ...l, amount_cents: Math.round(l.amount_cents * ratio), billable: false, billed: false })),
    note: done ? `From PO ${po.number}: ${formatCents(done)} is already billed, so this covers the rest.` : `From purchase order ${po.number}. The PO closes once bills cover its total.`,
  };
}

async function load(companyId: string, kind: PurchaseKind) {
  const [today, contacts, money, categories, terms, tracking] = await Promise.all([
    companyToday(companyId),
    listContactOptions(companyId, ["vendor", "customer", "employee", "other"]),
    listAccountsByType(companyId, kind === "check" ? ["bank"] : kind === "credit_card_credit" ? ["credit_card"] : ["bank", "credit_card"]),
    listCategoryAccounts(companyId),
    listTerms(companyId),
    listTracking(companyId),
  ]);
  return { today, contacts, moneyAccounts: money, categories, terms, tracking, customers: contacts.filter((c) => c.kind === "customer") };
}

function Saved({ text }: { text: string }) {
  return (
    <p role="status" className="mb-4 rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
      {text}
    </p>
  );
}

export function newPurchasePage(kind: PurchaseKind) {
  return async function NewPurchasePage({ params, searchParams }: NewProps) {
    const { companyId } = await params;
    const { vendor, saved, fromPo } = await searchParams;
    await requireCompany(companyId, "standard");
    const [data, prefill] = await Promise.all([load(companyId, kind), kind === "bill" && fromPo ? prefillFromPo(companyId, fromPo) : null]);
    return (
      <>
        {saved && <Saved text={`${NOUN[kind]} saved.`} />}
        <PurchaseForm key={saved ?? "new"} kind={kind} companyId={companyId} {...data} initial={null} presetVendorId={vendor} prefill={prefill} />
      </>
    );
  };
}

export function editPurchasePage(kind: PurchaseKind) {
  return async function EditPurchasePage({ params, searchParams }: EditProps) {
    const { companyId, id } = await params;
    const { saved } = await searchParams;
    await requireCompany(companyId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const [doc, data] = await Promise.all([getPurchaseDoc(companyId, id, kind), load(companyId, kind)]);
    if (!doc) notFound();
    return (
      <>
        {saved && <Saved text={`${NOUN[kind]} saved.`} />}
        <PurchaseForm key={doc.updated_at} kind={kind} companyId={companyId} {...data} initial={doc} />
      </>
    );
  };
}
