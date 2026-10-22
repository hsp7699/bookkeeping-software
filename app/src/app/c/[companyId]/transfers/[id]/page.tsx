import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { loadTransfer } from "../load";
import { TransferForm } from "../transfer-form";

export default async function TransferPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await loadTransfer(companyId, id);
  if (!d.initial) notFound();
  return <TransferForm key={d.initial.updated_at} companyId={companyId} {...d} />;
}
