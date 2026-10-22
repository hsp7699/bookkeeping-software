import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatDate, fiscalYearStart } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { balanceSheet, type BsGroup } from "@/lib/reports/statements";
import { ReportToolbar } from "../report-toolbar";

export default async function BalanceSheetPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const p = await readParams(companyId, await searchParams);
  const bs = await balanceSheet(companyId, p.asOf, p.basis, p.fyStartMonth);
  const fy = fiscalYearStart(p.asOf, p.fyStartMonth);
  const drill = (accountId: string | null, name: string) => {
    if (accountId) return `/c/${companyId}/reports/transactions?account=${accountId}&to=${p.asOf}&basis=${p.basis}`;
    if (name === "Net Income") return `/c/${companyId}/reports/profit-and-loss?range=custom&from=${fy}&to=${p.asOf}&basis=${p.basis}`;
    return undefined;
  };
  const Group = ({ g }: { g: BsGroup }) => (
    <>
      <tr>
        <th scope="rowgroup" colSpan={2} className="pt-3 pb-1 pl-4 text-left font-semibold">
          {g.title}
        </th>
      </tr>
      {g.lines.map((l) => (
        <tr key={l.accountId ?? l.name} className="hover:bg-row-hover">
          <th scope="row" className="py-1 text-left font-normal" style={{ paddingLeft: 36 + l.depth * 20 }}>
            {l.name}
          </th>
          <Amount cents={l.amount} href={drill(l.accountId, l.name)} />
        </tr>
      ))}
      <tr className="border-t border-border">
        <th scope="row" className="py-1.5 pl-4 text-left font-semibold">
          Total {g.title.toLowerCase()}
        </th>
        <Amount cents={g.total} strong />
      </tr>
    </>
  );
  const Big = ({ label, cents, double }: { label: string; cents: number; double?: boolean }) => (
    <tr className={cn(double ? "border-t-4 border-double border-text" : "border-t-2 border-text")}>
      <th scope="row" className="py-2 text-left text-md font-bold">
        {label}
      </th>
      <Amount cents={cents} strong className="text-md" />
    </tr>
  );
  return (
    <ReportFrame
      companyId={companyId}
      title="Balance sheet"
      companyName={p.companyName}
      subtitle={`As of ${formatDate(p.asOf)} · ${p.basis === "cash" ? "Cash basis" : "Accrual basis"}`}
      toolbar={<ReportToolbar mode="asOf" asOf={p.asOf} basis={p.basis} />}
    >
      {bs.outOfBalance !== 0 && (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
          This balance sheet is off by {formatCents(bs.outOfBalance)}. That shouldn&apos;t happen; please report it.
        </p>
      )}
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <th scope="rowgroup" colSpan={2} className="pb-1 text-left text-md font-bold">
              Assets
            </th>
          </tr>
          {bs.assets.map((g) => (
            <Group key={g.title} g={g} />
          ))}
          <Big label="Total assets" cents={bs.totalAssets} />
          <tr>
            <th scope="rowgroup" colSpan={2} className="pt-6 pb-1 text-left text-md font-bold">
              Liabilities and equity
            </th>
          </tr>
          {bs.liabilities.map((g) => (
            <Group key={g.title} g={g} />
          ))}
          <tr className="border-t border-border">
            <th scope="row" className="py-1.5 text-left font-semibold">
              Total liabilities
            </th>
            <Amount cents={bs.totalLiabilities} strong />
          </tr>
          <Group g={bs.equity} />
          <Big label="Total liabilities and equity" cents={bs.totalLiabilities + bs.totalEquity} double />
        </tbody>
      </table>
    </ReportFrame>
  );
}
