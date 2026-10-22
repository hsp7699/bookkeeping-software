import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { companyToday, getPurchaseDoc, listAccountsByType, listCategoryAccounts, listContactOptions, listTerms, listTracking } from "@/lib/queries";
import { PurchaseForm, type PurchaseKind } from "./purchase-form";

type NewProps = { params: Promise<{ companyId: string }>; searchParams: Promise<{ vendor?: string; saved?: string }> };
type EditProps = { params: Promise<{ companyId: string; id: string }>; searchParams: Promise<{ saved?: string }> };

const NOUN: Record<PurchaseKind, string> = { expense: "Expense", check: "Check", bill: "Bill", vendor_credit: "Vendor credit", credit_card_credit: "Credit card credit" };

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
    const { vendor, saved } = await searchParams;
    await requireCompany(companyId, "standard");
    const data = await load(companyId, kind);
    return (
      <>
        {saved && <Saved text={`${NOUN[kind]} saved.`} />}
        <PurchaseForm key={saved ?? "new"} kind={kind} companyId={companyId} {...data} initial={null} presetVendorId={vendor} />
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
