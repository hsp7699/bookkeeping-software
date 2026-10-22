import Link from "next/link";
import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { expensesByVendor, salesByCustomer } from "@/lib/reports/more";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { ReportToolbar } from "./report-toolbar";

/** Sales by customer, or expenses by vendor: one row per name, share of the total. */
export function byNamePage(kind: "sales" | "expenses") {
  return async function ByNamePage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams> }) {
    const { companyId } = await params;
    await requireCompany(companyId);
    const p = await readParams(companyId, await searchParams);
    const rows = kind === "sales" ? await salesByCustomer(companyId, p.from, p.to, p.basis) : await expensesByVendor(companyId, p.from, p.to, p.basis);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const title = kind === "sales" ? "Sales by customer" : "Expenses by vendor";
    return (
      <ReportFrame
        companyId={companyId}
        title={title}
        companyName={p.companyName}
        subtitle={`${formatDate(p.from)} – ${formatDate(p.to)} · ${p.basis === "cash" ? "Cash basis" : "Accrual basis"}`}
        toolbar={<ReportToolbar from={p.from} to={p.to} basis={p.basis} preset={p.preset} />}
      >
        {rows.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Nothing in this period.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-xs text-text-muted uppercase">
                <th className="py-2 text-left">{kind === "sales" ? "Customer" : "Vendor"}</th>
                <th className="py-2 pl-4 text-right">Amount</th>
                <th className="py-2 pl-4 text-right">% of total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contact_id ?? "none"} className="border-b border-border hover:bg-row-hover">
                  <th scope="row" className="py-1 text-left font-normal">
                    {r.contact_id ? (
                      <Link className="text-accent hover:underline" href={`/c/${companyId}/${kind === "sales" ? "customers" : "vendors"}/${r.contact_id}`}>
                        {r.name}
                      </Link>
                    ) : (
                      <span className="text-text-muted">{r.name}</span>
                    )}
                  </th>
                  <Amount cents={r.amount} />
                  <td className="num py-1 pl-4 text-text-muted">{total ? `${((r.amount / total) * 100).toFixed(1)}%` : ""}</td>
                </tr>
              ))}
              <tr className="border-t-4 border-double border-text">
                <th scope="row" className="py-2 text-left font-semibold">
                  Total
                </th>
                <Amount cents={total} strong />
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </ReportFrame>
    );
  };
}
