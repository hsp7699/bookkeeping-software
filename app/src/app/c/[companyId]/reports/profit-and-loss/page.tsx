import Link from "next/link";
import { Card } from "@/components/ui/table";
import { one } from "@/db";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { profitAndLoss, type ReportSection } from "@/lib/reports/pnl";
import { PRESETS, resolveRange, type Preset } from "@/lib/reports/range";
import { companyToday } from "@/lib/queries";
import { ReportToolbar } from "../report-toolbar";

function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("num", cents < 0 && "text-negative-amount", className)}>{formatCents(cents)}</span>;
}

function Section({ s }: { s: ReportSection }) {
  if (s.rows.length === 0 && s.key !== "income" && s.key !== "expenses") return null;
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={2} className="pt-4 pb-1 text-left font-semibold">
          {s.title}
        </th>
      </tr>
      {s.rows.map((r) => (
        <tr key={r.accountId} className="hover:bg-row-hover">
          <th scope="row" className="py-1 pl-6 text-left font-normal">
            {r.name}
          </th>
          <td className="py-1 text-right">
            <Money cents={r.amountCents} />
          </td>
        </tr>
      ))}
      <tr className="border-t border-border">
        <th scope="row" className="py-1.5 text-left font-semibold">
          Total {s.title.toLowerCase()}
        </th>
        <td className="py-1.5 text-right font-semibold">
          <Money cents={s.totalCents} />
        </td>
      </tr>
    </>
  );
}

function Total({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <tr className={cn(strong ? "border-t-4 border-double border-text" : "border-t border-border")}>
      <th scope="row" className={cn("py-2 text-left font-semibold", strong && "text-md")}>
        {label}
      </th>
      <td className={cn("py-2 text-right font-semibold", strong && "text-md")}>
        <Money cents={cents} />
      </td>
    </tr>
  );
}

export default async function ProfitAndLossPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; basis?: string }>;
}) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId);
  const [today, company] = await Promise.all([
    companyToday(companyId),
    one<{ fiscal_year_start_month: number; accounting_method: "accrual" | "cash" }>(
      "select fiscal_year_start_month, accounting_method from companies where id = $1",
      [companyId],
    ),
  ]);
  const preset = (PRESETS.find(([k]) => k === sp.range)?.[0] ?? "fy_to_date") as Preset;
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  let [from, to] = resolveRange(preset, today, company!.fiscal_year_start_month);
  if (preset === "custom") {
    from = valid(sp.from) ?? from;
    to = valid(sp.to) ?? to;
  }
  const basis = sp.basis === "cash" || sp.basis === "accrual" ? sp.basis : company!.accounting_method;
  const r = await profitAndLoss(companyId, from, to, basis);
  const empty = [r.income, r.cogs, r.expenses, r.otherIncome, r.otherExpense].every((s) => s.rows.length === 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/c/${companyId}/reports`} className="text-sm text-accent hover:underline">
          ← Reports
        </Link>
        <h1 className="mt-1 text-xl font-bold">Profit and loss</h1>
      </div>
      <ReportToolbar from={from} to={to} basis={basis} preset={preset} />
      <Card className="mx-auto w-full max-w-3xl px-8 py-8">
        <header className="mb-6 text-center">
          <p className="text-md font-semibold">{ctx.companyName}</p>
          <p className="text-lg font-bold">Profit and loss</p>
          <p className="text-text-muted">
            {formatDate(from)} – {formatDate(to)} · {basis === "cash" ? "Cash basis" : "Accrual basis"}
          </p>
        </header>
        {empty ? (
          <p className="py-8 text-center text-text-muted">No income or expenses in this period.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sr-only">
              <tr>
                <th>Account</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <Section s={r.income} />
              {r.cogs.rows.length > 0 && (
                <>
                  <Section s={r.cogs} />
                  <Total label="Gross profit" cents={r.grossProfitCents} />
                </>
              )}
              <Section s={r.expenses} />
              <Total label="Net operating income" cents={r.netOperatingIncomeCents} />
              {(r.otherIncome.rows.length > 0 || r.otherExpense.rows.length > 0) && (
                <>
                  <Section s={r.otherIncome} />
                  <Section s={r.otherExpense} />
                  <Total label="Net other income" cents={r.netOtherIncomeCents} />
                </>
              )}
              <Total label="Net income" cents={r.netIncomeCents} strong />
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
