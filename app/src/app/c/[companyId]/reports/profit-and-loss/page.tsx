import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { profitAndLoss, type ReportSection } from "@/lib/reports/pnl";
import { ReportToolbar } from "../report-toolbar";

function monthLabel(m: string) {
  if (m === "Total") return "Total";
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function ProfitAndLossPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const p = await readParams(companyId, await searchParams);
  const r = await profitAndLoss(companyId, p.from, p.to, p.basis, p.byMonth);
  const empty = [r.income, r.cogs, r.expenses, r.otherIncome, r.otherExpense].every((s) => s.rows.length === 0);
  const drill = (accountId: string, col: number) => {
    const [from, to] =
      r.columns[col] === "Total"
        ? [p.from, p.to]
        : [`${r.columns[col]}-01`, new Date(Date.UTC(Number(r.columns[col].slice(0, 4)), Number(r.columns[col].slice(5, 7)), 0)).toISOString().slice(0, 10)];
    return `/c/${companyId}/reports/transactions?account=${accountId}&from=${from < p.from ? p.from : from}&to=${to > p.to ? p.to : to}&basis=${p.basis}`;
  };

  const Totals = ({ label, values, strong }: { label: string; values: number[]; strong?: boolean }) => (
    <tr className={cn(strong ? "border-t-4 border-double border-text" : "border-t border-border")}>
      <th scope="row" className={cn("py-2 pr-4 text-left font-semibold whitespace-nowrap", strong && "text-md")}>
        {label}
      </th>
      {values.map((v, i) => (
        <Amount key={i} cents={v} strong className={cn(strong && "text-md")} />
      ))}
    </tr>
  );
  const Section = ({ s }: { s: ReportSection }) => {
    if (s.rows.length === 0 && s.key !== "income" && s.key !== "expenses") return null;
    return (
      <>
        <tr>
          <th scope="rowgroup" colSpan={r.columns.length + 1} className="pt-4 pb-1 text-left font-semibold">
            {s.title}
          </th>
        </tr>
        {s.rows.map((row) => (
          <tr key={row.accountId} className="hover:bg-row-hover">
            <th scope="row" className="py-1 pr-4 text-left font-normal whitespace-nowrap" style={{ paddingLeft: 24 + row.depth * 20 }}>
              {row.name}
            </th>
            {row.amounts.map((v, i) => (
              <Amount key={i} cents={v} href={drill(row.accountId, i)} />
            ))}
          </tr>
        ))}
        <Totals label={`Total ${s.title.toLowerCase()}`} values={s.totals} />
      </>
    );
  };

  return (
    <ReportFrame
      companyId={companyId}
      title="Profit and loss"
      companyName={p.companyName}
      subtitle={`${formatDate(p.from)} – ${formatDate(p.to)} · ${p.basis === "cash" ? "Cash basis" : "Accrual basis"}`}
      wide={p.byMonth}
      toolbar={<ReportToolbar from={p.from} to={p.to} basis={p.basis} preset={p.preset} columns={p.byMonth ? "months" : "total"} showColumns />}
    >
      {empty ? (
        <p className="py-8 text-center text-text-muted">No income or expenses in this period.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead className={cn(!p.byMonth && "sr-only")}>
            <tr className="border-b border-border text-xs text-text-muted uppercase">
              <th className="py-2 text-left">Account</th>
              {r.columns.map((c) => (
                <th key={c} className="py-2 pl-4 text-right whitespace-nowrap">
                  {monthLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Section s={r.income} />
            {r.cogs.rows.length > 0 && (
              <>
                <Section s={r.cogs} />
                <Totals label="Gross profit" values={r.grossProfit} />
              </>
            )}
            <Section s={r.expenses} />
            <Totals label="Net operating income" values={r.netOperatingIncome} />
            {(r.otherIncome.rows.length > 0 || r.otherExpense.rows.length > 0) && (
              <>
                <Section s={r.otherIncome} />
                <Section s={r.otherExpense} />
                <Totals label="Net other income" values={r.netOtherIncome} />
              </>
            )}
            <Totals label="Net income" values={r.netIncome} strong />
          </tbody>
        </table>
      )}
    </ReportFrame>
  );
}
