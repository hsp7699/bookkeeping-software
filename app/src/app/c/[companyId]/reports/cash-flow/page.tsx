import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { cashFlow, type CashFlowLine } from "@/lib/reports/more";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { ReportToolbar } from "../report-toolbar";

export default async function CashFlowPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const p = await readParams(companyId, await searchParams);
  const cf = await cashFlow(companyId, p.from, p.to, p.basis);
  const drill = (id: string | null) => (id ? `/c/${companyId}/reports/transactions?account=${id}&from=${p.from}&to=${p.to}&basis=${p.basis}` : undefined);
  const Lines = ({ title, lines, total, extra }: { title: string; lines: CashFlowLine[]; total: number; extra?: React.ReactNode }) => (
    <>
      <tr>
        <th scope="rowgroup" colSpan={2} className="pt-4 pb-1 text-left font-semibold">
          {title}
        </th>
      </tr>
      {extra}
      {lines.map((l) => (
        <tr key={l.id ?? l.name} className="hover:bg-row-hover">
          <th scope="row" className="py-1 pl-6 text-left font-normal">
            {l.name}
          </th>
          <Amount cents={l.amount} href={drill(l.id)} />
        </tr>
      ))}
      <tr className="border-t border-border">
        <th scope="row" className="py-1.5 text-left font-semibold">
          Net cash from {title.toLowerCase()}
        </th>
        <Amount cents={total} strong />
      </tr>
    </>
  );
  return (
    <ReportFrame
      companyId={companyId}
      title="Statement of cash flows"
      companyName={p.companyName}
      subtitle={`${formatDate(p.from)} – ${formatDate(p.to)} · ${p.basis === "cash" ? "Cash basis" : "Accrual basis"}`}
      toolbar={<ReportToolbar from={p.from} to={p.to} basis={p.basis} preset={p.preset} />}
    >
      <table className="w-full border-collapse">
        <tbody>
          <Lines
            title="Operating activities"
            lines={cf.operating}
            total={cf.netOperating}
            extra={
              <tr className="hover:bg-row-hover">
                <th scope="row" className="py-1 pl-6 text-left font-normal">
                  Net income
                </th>
                <Amount cents={cf.netIncome} href={`/c/${companyId}/reports/profit-and-loss?range=custom&from=${p.from}&to=${p.to}&basis=${p.basis}`} />
              </tr>
            }
          />
          {cf.investing.length > 0 && <Lines title="Investing activities" lines={cf.investing} total={cf.netInvesting} />}
          {cf.financing.length > 0 && <Lines title="Financing activities" lines={cf.financing} total={cf.netFinancing} />}
          <tr className="border-t-2 border-text">
            <th scope="row" className="py-2 text-left font-semibold">
              Net change in cash
            </th>
            <Amount cents={cf.netChange} strong />
          </tr>
          <tr>
            <th scope="row" className="py-1 text-left font-normal">
              Cash at the start
            </th>
            <Amount cents={cf.cashStart} />
          </tr>
          <tr className="border-t-4 border-double border-text">
            <th scope="row" className="py-2 text-left text-md font-bold">
              Cash at the end
            </th>
            <Amount cents={cf.cashEnd} strong className="text-md" />
          </tr>
        </tbody>
      </table>
    </ReportFrame>
  );
}
