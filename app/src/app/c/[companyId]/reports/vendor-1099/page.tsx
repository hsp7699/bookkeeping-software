import Link from "next/link";
import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { vendor1099 } from "@/lib/reports/more";
import { readParams } from "@/lib/reports/params";

export default async function Vendor1099Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ year?: string }> }) {
  const { companyId } = await params;
  const sp = await searchParams;
  await requireCompany(companyId);
  const p = await readParams(companyId, {});
  const thisYear = Number(p.today.slice(0, 4));
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= thisYear ? Number(sp.year) : thisYear - (Number(p.today.slice(5, 7)) <= 2 ? 1 : 0);
  const r = await vendor1099(companyId, year);
  const base = `/c/${companyId}/reports/vendor-1099`;
  return (
    <ReportFrame
      companyId={companyId}
      title="1099 vendor payments"
      companyName={p.companyName}
      subtitle={`Calendar year ${year} · paid from bank accounts`}
      toolbar={
        <nav className="flex gap-2 print:hidden" aria-label="Year">
          {[thisYear - 2, thisYear - 1, thisYear].map((y) => (
            <Link key={y} href={`${base}?year=${y}`} aria-current={y === year ? "page" : undefined} className={cn("rounded-pill px-3 py-1 text-sm font-medium", y === year ? "bg-accent-soft text-on-accent-soft" : "text-text-muted hover:bg-row-hover")}>
              {y}
            </Link>
          ))}
        </nav>
      }
    >
      <p className="mb-4 text-sm text-text-muted">
        Vendors marked &ldquo;Track payments for 1099&rdquo;. Payments by credit card are left out because the card company reports those. The {year} filing threshold used here is{" "}
        {formatCents(r.thresholdCents)}; check the IRS instructions before filing.
      </p>
      {r.rows.length === 0 ? (
        <p className="py-8 text-center text-text-muted">No payments to 1099 vendors in {year}. Mark a vendor for 1099 tracking on its edit screen.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted uppercase">
              <th className="py-2 text-left">Vendor</th>
              <th className="py-2 text-left">Tax ID</th>
              <th className="py-2 pl-4 text-right">Paid</th>
              <th className="py-2 pl-4 text-left">Over threshold</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((v) => (
              <tr key={v.id} className="border-b border-border hover:bg-row-hover">
                <th scope="row" className="py-1 text-left font-normal">
                  <Link className="text-accent hover:underline" href={`/c/${companyId}/vendors/${v.id}`}>
                    {v.name}
                  </Link>
                </th>
                <td className="py-1">{v.tax_id ?? <span className="text-warning">Missing</span>}</td>
                <Amount cents={v.paid_cents} />
                <td className="py-1 pl-4">{v.paid_cents >= r.thresholdCents ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportFrame>
  );
}
