import { requireCompany } from "@/lib/authz";
import { loadTransfer } from "../load";
import { TransferForm } from "../transfer-form";

export default async function NewTransferPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId, "standard");
  const d = await loadTransfer(companyId, null);
  return <TransferForm companyId={companyId} {...d} />;
}
