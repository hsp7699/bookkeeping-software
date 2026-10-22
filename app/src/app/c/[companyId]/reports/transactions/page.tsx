import Link from "next/link";
import { Amount, ReportFrame } from "@/components/report-frame";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import type { AccountType } from "@/lib/coa";
import { formatDate } from "@/lib/dates";
import { natural, drilldown, type Basis } from "@/lib/reports/core";
import { TXN_LABEL, txnHref } from "@/lib/routes";

/** Drill-down: the transactions behind a number on a report. */
export default async function DrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ account?: string; from?: string; to?: string; basis?: string }>;
}) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId);
  const isDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const accountId = sp.account && /^[0-9a-f-]{36}$/i.test(sp.account) ? sp.account : null;
  const acct = accountId ? (await query<{ name: string; type: AccountType }>("select name, type from accounts where company_id = $1 and id = $2", [companyId, accountId]))[0] : null;
  const to = isDate(sp.to) ?? new Date().toISOString().slice(0, 10);
  const from = isDate(sp.from);
  const basis: Basis = sp.basis === "cash" ? "cash" : "accrual";
  const rows = acct ? await drilldown(companyId, basis, [accountId!], from, to) : [];
  const total = rows.reduce((s, r) => s + natural(r.account_type, r.net), 0);
  return (
    <ReportFrame
      companyId={companyId}
      title={acct ? `${acct.name} transactions` : "Transactions"}
      companyName={ctx.companyName}
      subtitle={`${from ? `${formatDate(from)} – ` : "Through "}${formatDate(to)} · ${basis === "cash" ? "Cash basis" : "Accrual basis"}`}
      wide
      toolbar={null}
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-text-muted">No transactions.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted uppercase">
              <th className="py-2">Date</th>
              <th className="py-2">Type</th>
              <th className="py-2">No.</th>
              <th className="py-2">Name</th>
              <th className="py-2">Memo</th>
              <th className="py-2 pl-4 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border hover:bg-row-hover">
                <td className="py-1 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                <td className="py-1">
                  <Link className="text-accent hover:underline" href={txnHref(companyId, r.type, r.transaction_id)}>
                    {TXN_LABEL[r.type]}
                  </Link>
                </td>
                <td className="py-1">{r.number}</td>
                <td className="py-1">{r.contact}</td>
                <td className="max-w-xs truncate py-1 text-text-muted">{r.memo}</td>
                <Amount cents={natural(r.account_type, r.net)} />
              </tr>
            ))}
            <tr className="border-t-4 border-double border-text">
              <th scope="row" colSpan={5} className="py-2 text-left font-semibold">
                Total
              </th>
              <Amount cents={total} strong />
            </tr>
          </tbody>
        </table>
      )}
    </ReportFrame>
  );
}
