import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { ACCOUNT_TYPE_LABELS } from "@/lib/coa";
import { formatDate } from "@/lib/dates";
import { trialBalance } from "@/lib/reports/more";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { ReportToolbar } from "../report-toolbar";

export default async function TrialBalancePage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const p = await readParams(companyId, await searchParams);
  const tb = await trialBalance(companyId, p.asOf, p.basis, p.fyStartMonth);
  return (
    <ReportFrame
      companyId={companyId}
      title="Trial balance"
      companyName={p.companyName}
      subtitle={`As of ${formatDate(p.asOf)} · ${p.basis === "cash" ? "Cash basis" : "Accrual basis"}`}
      toolbar={<ReportToolbar mode="asOf" asOf={p.asOf} basis={p.basis} />}
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-xs text-text-muted uppercase">
            <th className="py-2 text-left">Account</th>
            <th className="py-2 text-left">Type</th>
            <th className="py-2 pl-4 text-right">Debit</th>
            <th className="py-2 pl-4 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {tb.rows.map((r) => (
            <tr key={r.id ?? r.name} className="border-b border-border hover:bg-row-hover">
              <th scope="row" className="py-1 text-left font-normal">
                {r.name}
              </th>
              <td className="py-1 text-sm text-text-muted">{ACCOUNT_TYPE_LABELS[r.type as keyof typeof ACCOUNT_TYPE_LABELS]}</td>
              {r.debit ? <Amount cents={r.debit} href={r.id ? `/c/${companyId}/reports/transactions?account=${r.id}&to=${p.asOf}&basis=${p.basis}` : undefined} /> : <td />}
              {r.credit ? <Amount cents={r.credit} href={r.id ? `/c/${companyId}/reports/transactions?account=${r.id}&to=${p.asOf}&basis=${p.basis}` : undefined} /> : <td />}
            </tr>
          ))}
          <tr className="border-t-4 border-double border-text">
            <th scope="row" colSpan={2} className="py-2 text-left font-semibold">
              Total
            </th>
            <Amount cents={tb.debit} strong />
            <Amount cents={tb.credit} strong />
          </tr>
        </tbody>
      </table>
    </ReportFrame>
  );
}
