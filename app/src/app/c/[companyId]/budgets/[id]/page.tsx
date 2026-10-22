import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/authz";
import { loadBudget } from "@/lib/budgets";
import { BudgetGrid } from "./budget-grid";

export default async function BudgetPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await loadBudget(companyId, id);
  if (!b) notFound();
  return <BudgetGrid companyId={companyId} budget={b} />;
}
