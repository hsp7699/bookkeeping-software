import Link from "next/link";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { salesTaxLiability } from "@/lib/reports/more";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { listAccountsByType } from "@/lib/queries";
import { ReportToolbar } from "../reports/report-toolbar";
import { RecordTaxPayment } from "./record-payment";

export default async function TaxesPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams> }) {
  const { companyId } = await params;
  await requireCompany(companyId, "standard");
  const p = await readParams(companyId, await searchParams, "last_quarter");
  const [st, accounts] = await Promise.all([salesTaxLiability(companyId, p.from, p.to), listAccountsByType(companyId, ["bank", "credit_card"])]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Sales tax</h1>
        <RecordTaxPayment companyId={companyId} accounts={accounts} suggestedCents={Math.max(st.owedEnd, 0)} today={p.today} />
      </div>
      <ReportToolbar from={p.from} to={p.to} preset={p.preset} showBasis={false} />
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Owed at the start", st.owedStart],
          ["Tax charged in the period", st.taxCollected],
          ["Paid to agencies", st.paid],
          ["Owed at the end", st.owedEnd],
        ].map(([label, v]) => (
          <Card key={label as string} className="p-4">
            <p className="text-sm text-text-muted">{label}</p>
            <p className="num text-left text-xl font-bold">{formatCents(v as number)}</p>
          </Card>
        ))}
      </div>
      <p className="text-sm text-text-muted">
        {formatDate(p.from)} – {formatDate(p.to)}. Tax is counted when invoiced (accrual). &ldquo;Owed&rdquo; is the balance of Sales Tax Payable, including any adjustments made by journal entry.
      </p>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Rate</Th>
              <Th>Agency</Th>
              <Th numeric>Rate</Th>
              <Th numeric>Taxable sales</Th>
              <Th numeric>Tax</Th>
            </tr>
          </thead>
          <tbody>
            {st.byRate.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-text-muted">
                  No taxed sales in this period.{" "}
                  <Link href={`/c/${companyId}/settings`} className="text-accent hover:underline">
                    Add tax rates in Settings
                  </Link>
                </td>
              </tr>
            )}
            {st.byRate.map((r) => (
              <Tr key={r.rate_id ?? "none"}>
                <Td>{r.name}</Td>
                <Td>{r.agency}</Td>
                <Td numeric>{r.rate_bp != null ? `${(r.rate_bp / 100).toFixed(2)}%` : ""}</Td>
                <Td numeric>{formatCents(r.taxable_cents)}</Td>
                <Td numeric>{formatCents(r.tax_cents)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Payments in this period</h2>
        <Card>
          {st.payments.length === 0 ? (
            <p className="p-6 text-center text-text-muted">No sales tax payments recorded in this period.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Paid from</Th>
                  <Th>Memo</Th>
                  <Th numeric>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {st.payments.map((x) => (
                  <Tr key={x.id}>
                    <Td>{formatDate(x.txn_date)}</Td>
                    <Td>{x.account}</Td>
                    <Td className="text-text-muted">{x.memo}</Td>
                    <Td numeric>{formatCents(x.total_cents)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
