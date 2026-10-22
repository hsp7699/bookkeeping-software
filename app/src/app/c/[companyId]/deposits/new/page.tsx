import { requireCompany } from "@/lib/authz";
import { DepositForm } from "../deposit-form";
import { loadDeposit } from "../load";

export default async function NewDepositPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId, "standard");
  const d = await loadDeposit(companyId, null);
  return <DepositForm companyId={companyId} {...d} />;
}
