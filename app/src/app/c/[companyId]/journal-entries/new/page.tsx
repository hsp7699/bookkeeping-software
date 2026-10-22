import { requireCompany } from "@/lib/authz";
import { JournalForm } from "../journal-form";
import { loadJournal } from "../load";

export default async function NewJournalPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId, "standard");
  const d = await loadJournal(companyId, null);
  return <JournalForm companyId={companyId} {...d} initial={null} />;
}
