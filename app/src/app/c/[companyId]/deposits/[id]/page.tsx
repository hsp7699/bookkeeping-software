import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { DepositForm } from "../deposit-form";
import { loadDeposit } from "../load";

export default async function DepositPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await loadDeposit(companyId, id);
  if (!d.initial) notFound();
  return <DepositForm key={d.initial.updated_at} companyId={companyId} {...d} />;
}
