import Link from "next/link";
import { Amount, ReportFrame } from "@/components/report-frame";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { readParams, type ReportParams } from "@/lib/reports/params";
import { generalLedger } from "@/lib/reports/statements";
import { TXN_LABEL, txnHref } from "@/lib/routes";
import { ReportToolbar } from "../report-toolbar";

export default async function GeneralLedgerPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<ReportParams & { account?: string }> }) {
  const { companyId } = await params;
  const sp = await searchParams;
  await requireCompany(companyId);
  const p = await readParams(companyId, sp, "this_month");
  const account = sp.account && /^[0-9a-f-]{36}$/i.test(sp.account) ? sp.account : null;
  const gl = await generalLedger(companyId, p.from, p.to, p.basis, account);
  return (
    <ReportFrame
      companyId={companyId}
      title="General ledger"
      companyName={p.companyName}
      subtitle={`${formatDate(p.from)} – ${formatDate(p.to)} · ${p.basis === "cash" ? "Cash basis" : "Accrual basis"}`}
      wide
      toolbar={<ReportToolbar from={p.from} to={p.to} basis={p.basis} preset={p.preset} />}
    >
      {gl.length === 0 ? (
        <p className="py-8 text-center text-text-muted">No activity in this period.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted uppercase">
              <th className="py-2">Date</th>
              <th className="py-2">Type</th>
              <th className="py-2">No.</th>
              <th className="py-2">Name</th>
              <th className="py-2">Memo</th>
              <th className="py-2 pl-4 text-right">Amount</th>
              <th className="py-2 pl-4 text-right">Balance</th>
            </tr>
          </thead>
          {gl.map((a) => (
            <tbody key={a.id}>
              <tr>
                <th scope="rowgroup" colSpan={6} className="pt-4 pb-1 text-left text-base font-semibold">
                  {a.name}
                </th>
                <Amount cents={a.opening} className="pt-4 text-text-muted" />
              </tr>
              {a.rows.map((r, i) => (
                <tr key={i} className="hover:bg-row-hover">
                  <td className="py-1 pl-4 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                  <td className="py-1">
                    <Link className="text-accent hover:underline" href={txnHref(companyId, r.type, r.transaction_id)}>
                      {TXN_LABEL[r.type]}
                    </Link>
                  </td>
                  <td className="py-1">{r.number}</td>
                  <td className="py-1">{r.contact}</td>
                  <td className="max-w-xs truncate py-1 text-text-muted">{r.memo}</td>
                  <Amount cents={r.amount} />
                  <Amount cents={r.balance} />
                </tr>
              ))}
              <tr className="border-t border-border font-semibold">
                <th scope="row" colSpan={5} className="py-1.5 pl-4 text-left">
                  Total {a.name}
                </th>
                <Amount cents={a.closing - a.opening} strong />
                <Amount cents={a.closing} strong />
              </tr>
            </tbody>
          ))}
        </table>
      )}
    </ReportFrame>
  );
}
