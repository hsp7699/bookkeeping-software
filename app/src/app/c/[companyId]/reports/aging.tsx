import Link from "next/link";
import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { aging } from "@/lib/reports/statements";
import { TXN_LABEL, txnHref } from "@/lib/routes";
import { ReportToolbar } from "./report-toolbar";

const BUCKETS = [
  ["current", "Current"],
  ["d1_30", "1–30"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d91", "91 and over"],
  ["total", "Total"],
] as const;

/** A/R or A/P aging, summary (by name) or detail (by document). */
export function agingPage(side: "ar" | "ap") {
  return async function AgingPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams & { view?: string }> }) {
    const { companyId } = await params;
    const sp = await searchParams;
    await requireCompany(companyId);
    const p = await readParams(companyId, sp);
    const r = await aging(companyId, side, p.asOf);
    const detail = sp.view === "detail";
    const title = side === "ar" ? "A/R aging" : "A/P aging";
    const base = `/c/${companyId}/reports/${side}-aging`;
    return (
      <ReportFrame
        companyId={companyId}
        title={`${title} ${detail ? "detail" : "summary"}`}
        companyName={p.companyName}
        subtitle={`As of ${formatDate(p.asOf)} · days past due`}
        wide
        toolbar={
          <div className="flex flex-col gap-3">
            <ReportToolbar mode="asOf" asOf={p.asOf} showBasis={false} />
            <Link href={`${base}?asOf=${p.asOf}${detail ? "" : "&view=detail"}`} className="text-accent hover:underline print:hidden">
              {detail ? "Show summary" : "Show detail"}
            </Link>
          </div>
        }
      >
        {r.rows.length === 0 ? (
          <p className="py-8 text-center text-text-muted">{side === "ar" ? "Nobody owes you anything as of this date." : "You don't owe anything as of this date."}</p>
        ) : detail ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted uppercase">
                <th className="py-2">Date</th>
                <th className="py-2">Type</th>
                <th className="py-2">No.</th>
                <th className="py-2">{side === "ar" ? "Customer" : "Vendor"}</th>
                <th className="py-2">Due date</th>
                <th className="py-2 text-right">Past due</th>
                <th className="py-2 pl-4 text-right">Open balance</th>
              </tr>
            </thead>
            <tbody>
              {r.detail.map((d) => (
                <tr key={d.id} className="border-b border-border hover:bg-row-hover">
                  <td className="py-1">{formatDate(d.txn_date)}</td>
                  <td className="py-1">
                    <Link className="text-accent hover:underline" href={txnHref(companyId, d.type, d.id)}>
                      {TXN_LABEL[d.type]}
                    </Link>
                  </td>
                  <td className="py-1">{d.number}</td>
                  <td className="py-1">{d.contact}</td>
                  <td className="py-1">{d.due_date ? formatDate(d.due_date) : ""}</td>
                  <td className="num py-1">{d.open > 0 && d.days > 0 ? d.days : ""}</td>
                  <Amount cents={d.open} />
                </tr>
              ))}
              <tr className="border-t-4 border-double border-text font-semibold">
                <th scope="row" colSpan={6} className="py-2 text-left">
                  Total
                </th>
                <Amount cents={r.totals.total} strong />
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-xs text-text-muted uppercase">
                <th className="py-2 text-left">{side === "ar" ? "Customer" : "Vendor"}</th>
                {BUCKETS.map(([k, l]) => (
                  <th key={k} className="py-2 pl-4 text-right whitespace-nowrap">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.contactId} className="border-b border-border hover:bg-row-hover">
                  <th scope="row" className="py-1 text-left font-normal">
                    <Link className="text-accent hover:underline" href={`/c/${companyId}/${side === "ar" ? "customers" : "vendors"}/${row.contactId}`}>
                      {row.name}
                    </Link>
                  </th>
                  {BUCKETS.map(([k]) => (
                    <Amount key={k} cents={row[k]} strong={k === "total"} />
                  ))}
                </tr>
              ))}
              <tr className="border-t-4 border-double border-text">
                <th scope="row" className="py-2 text-left font-semibold">
                  Total
                </th>
                {BUCKETS.map(([k]) => (
                  <Amount key={k} cents={r.totals[k]} strong />
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </ReportFrame>
    );
  };
}
