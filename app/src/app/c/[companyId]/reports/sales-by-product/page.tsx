import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { salesByProduct } from "@/lib/reports/more";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { ReportToolbar } from "../report-toolbar";

export default async function SalesByProductPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const p = await readParams(companyId, await searchParams);
  const rows = await salesByProduct(companyId, p.from, p.to);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <ReportFrame
      companyId={companyId}
      title="Sales by product or service"
      companyName={p.companyName}
      subtitle={`${formatDate(p.from)} – ${formatDate(p.to)} · from invoices, receipts, credit memos and refunds`}
      toolbar={<ReportToolbar from={p.from} to={p.to} preset={p.preset} showBasis={false} />}
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-text-muted">No sales in this period.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted uppercase">
              <th className="py-2 text-left">Product or service</th>
              <th className="py-2 pl-4 text-right">Quantity</th>
              <th className="py-2 pl-4 text-right">Amount</th>
              <th className="py-2 pl-4 text-right">Average price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_id ?? "none"} className="border-b border-border hover:bg-row-hover">
                <th scope="row" className="py-1 text-left font-normal">
                  {r.name}
                </th>
                <td className="num py-1 pl-4">{r.qty ? r.qty.toLocaleString("en-US") : ""}</td>
                <Amount cents={r.amount} />
                <td className="num py-1 pl-4">{r.avg_price != null ? formatCents(r.avg_price) : ""}</td>
              </tr>
            ))}
            <tr className="border-t-4 border-double border-text">
              <th scope="row" colSpan={2} className="py-2 text-left font-semibold">
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
}
