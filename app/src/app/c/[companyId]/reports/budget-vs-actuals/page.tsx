import { PiggyBank } from "lucide-react";
import Link from "next/link";
import { Amount, ReportFrame } from "@/components/report-frame";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { budgetVsActuals } from "@/lib/budgets";
import { formatDate } from "@/lib/dates";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { ReportToolbar } from "../report-toolbar";
import { BudgetPicker } from "./budget-picker";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "");

export default async function BudgetVsActualsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams & { budget?: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const sp = await searchParams;
  const p = await readParams(companyId, sp);
  const budgets = await query<{ id: string; name: string }>("select id, name from budgets where company_id = $1 order by fiscal_year desc, lower(name)", [companyId]);
  if (!budgets.length)
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-bold">Budget vs actuals</h1>
        <EmptyState icon={PiggyBank} title="No budgets yet" body="Make a budget first, then come back to see how you're tracking against it." />
        <div>
          <Button asChild variant="primary">
            <Link href={`/c/${companyId}/budgets`}>Go to budgets</Link>
          </Button>
        </div>
      </div>
    );
  const budgetId = budgets.find((b) => b.id === sp.budget)?.id ?? budgets[0].id;
  const r = (await budgetVsActuals(companyId, budgetId, p.from, p.to, p.basis))!;
  const drill = (id: string) => `/c/${companyId}/reports/transactions?account=${id}&from=${p.from}&to=${p.to}&basis=${p.basis}`;
  const head = (
    <tr className="border-b border-border text-xs text-text-muted uppercase">
      <th className="py-2 text-left">Account</th>
      <th className="py-2 pl-4 text-right">Actual</th>
      <th className="py-2 pl-4 text-right">Budget</th>
      <th className="py-2 pl-4 text-right">Over budget</th>
      <th className="py-2 pl-4 text-right">% of budget</th>
    </tr>
  );
  return (
    <ReportFrame
      companyId={companyId}
      title="Budget vs actuals"
      companyName={p.companyName}
      subtitle={`${r.budget.name} · ${formatDate(p.from)} to ${formatDate(p.to)} · ${p.basis === "cash" ? "Cash basis" : "Accrual basis"}`}
      toolbar={
        <div className="flex flex-col gap-3">
          <BudgetPicker budgets={budgets} value={budgetId} />
          <ReportToolbar from={p.from} to={p.to} basis={p.basis} preset={p.preset} />
        </div>
      }
    >
      <table className="w-full border-collapse">
        <thead>{head}</thead>
        {r.sections
          .filter((s) => s.rows.length)
          .map((s) => (
            <tbody key={s.key}>
              <tr>
                <th colSpan={5} className="pt-3 pb-1 text-left font-semibold">
                  {s.title}
                </th>
              </tr>
              {s.rows.map((row) => (
                <tr key={row.id} className="border-b border-border hover:bg-row-hover">
                  <th scope="row" className="py-1 text-left font-normal" style={{ paddingLeft: 16 + row.depth * 16 }}>
                    {row.name}
                  </th>
                  <Amount cents={row.actual} href={drill(row.id)} />
                  <Amount cents={row.budget} />
                  <Amount cents={row.actual - row.budget} />
                  <td className="py-1 pl-4 text-right text-text-muted">{pct(row.actual, row.budget)}</td>
                </tr>
              ))}
              <tr className="border-b border-border">
                <th scope="row" className="py-1 text-left font-semibold">
                  Total {s.title.toLowerCase()}
                </th>
                <Amount cents={s.actual} strong />
                <Amount cents={s.budget} strong />
                <Amount cents={s.actual - s.budget} strong />
                <td className="py-1 pl-4 text-right text-text-muted">{pct(s.actual, s.budget)}</td>
              </tr>
            </tbody>
          ))}
        <tfoot>
          <tr className="border-t-4 border-double border-text">
            <th scope="row" className="py-2 text-left font-semibold">
              Net income
            </th>
            <Amount cents={r.netIncome.actual} strong />
            <Amount cents={r.netIncome.budget} strong />
            <Amount cents={r.netIncome.actual - r.netIncome.budget} strong />
            <td className="py-2 pl-4 text-right text-text-muted">{pct(r.netIncome.actual, r.netIncome.budget)}</td>
          </tr>
        </tfoot>
      </table>
    </ReportFrame>
  );
}
