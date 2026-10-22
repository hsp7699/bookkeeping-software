import { PiggyBank } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { fiscalYearOf } from "@/lib/budgets/periods";
import { formatCents } from "@/lib/money";
import { companyToday } from "@/lib/queries";
import { NewBudget } from "./new-budget";

export default async function BudgetsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const [today, c, rows] = await Promise.all([
    companyToday(companyId),
    one<{ fy: number }>("select fiscal_year_start_month as fy from companies where id = $1", [companyId]),
    query<{ id: string; name: string; fiscal_year: number; income: string; expense: string }>(
      `select b.id, b.name, b.fiscal_year,
              coalesce(sum(l.amount_cents) filter (where a.type in ('income','other_income')), 0) as income,
              coalesce(sum(l.amount_cents) filter (where a.type in ('cost_of_goods_sold','expense','other_expense')), 0) as expense
       from budgets b left join budget_lines l on l.budget_id = b.id left join accounts a on a.id = l.account_id
       where b.company_id = $1 group by b.id order by b.fiscal_year desc, lower(b.name)`,
      [companyId],
    ),
  ]);
  const fy = fiscalYearOf(today, c!.fy);
  const label = (y: number) => (c!.fy === 1 ? `${y}` : `FY ${y}-${String(y + 1).slice(2)}`);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Budgets</h1>
          <p className="mt-1 text-text-muted">Plan income and expenses month by month, then compare with what actually happened.</p>
        </div>
        <NewBudget companyId={companyId} years={[fy - 1, fy, fy + 1].map((y) => ({ value: y, label: label(y) }))} defaultYear={fy} />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={PiggyBank} title="No budgets yet" body="Start one from scratch, or from last year's actual numbers and adjust from there." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Budget</Th>
                <Th>Fiscal year</Th>
                <Th numeric>Income</Th>
                <Th numeric>Expenses</Th>
                <Th numeric>Net income</Th>
                <Th>
                  <span className="sr-only">Report</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link className="font-medium text-accent hover:underline" href={`/c/${companyId}/budgets/${r.id}`}>
                      {r.name}
                    </Link>
                  </Td>
                  <Td>{label(r.fiscal_year)}</Td>
                  <Td numeric>{formatCents(Number(r.income))}</Td>
                  <Td numeric>{formatCents(Number(r.expense))}</Td>
                  <Td numeric>{formatCents(Number(r.income) - Number(r.expense))}</Td>
                  <Td className="text-right">
                    <Link className="text-accent hover:underline" href={`/c/${companyId}/reports/budget-vs-actuals?budget=${r.id}`}>
                      Budget vs actuals
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
