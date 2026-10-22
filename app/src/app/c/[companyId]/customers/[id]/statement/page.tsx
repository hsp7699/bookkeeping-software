import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { mailConfigured } from "@/lib/mail";
import { formatCents } from "@/lib/money";
import { companyToday } from "@/lib/queries";
import { loadStatement } from "@/lib/statements";
import { statementEmailText } from "./actions";
import { EmailStatement } from "./email-statement";
import { statementParams } from "./params";

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = statementParams(await searchParams, await companyToday(companyId));
  const st = await loadStatement(companyId, id, p.kind, p.from, p.to);
  if (!st) notFound();
  const text = await statementEmailText(companyId, id, p.kind, p.from, p.to);
  const base = `/c/${companyId}/customers/${id}`;
  const qs = new URLSearchParams({ kind: p.kind, from: p.from, to: p.to }).toString();
  const fwd = p.kind === "balance_forward";
  const buckets: [string, number][] = [
    ["Current", st.aging.current],
    ["1-30 days", st.aging.d1_30],
    ["31-60 days", st.aging.d31_60],
    ["61-90 days", st.aging.d61_90],
    ["Over 90 days", st.aging.d91],
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={base} className="text-sm text-accent hover:underline">
          ← {st.customer.name}
        </Link>
        <h1 className="mt-1 text-xl font-bold">Statement for {st.customer.name}</h1>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Type
          <select name="kind" defaultValue={p.kind} className="h-9 rounded-sm border border-border-input bg-bg px-2.5 font-normal">
            <option value="balance_forward">Balance forward</option>
            <option value="open_item">Open invoices only</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          From
          <input type="date" name="from" defaultValue={p.from} disabled={!fwd} className="h-9 rounded-sm border border-border-input bg-bg px-2.5 font-normal disabled:bg-surface" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {fwd ? "To" : "As of"}
          <input type="date" name="to" defaultValue={p.to} className="h-9 rounded-sm border border-border-input bg-bg px-2.5 font-normal" />
        </label>
        <Button type="submit">Update</Button>
        <div className="ml-auto flex gap-2">
          <Button asChild>
            <a href={`${base}/statement/pdf?${qs}&download=1`}>Download PDF</a>
          </Button>
          <EmailStatement companyId={companyId} customerId={id} params={p} emails={st.customer.emails} text={text} mailReady={mailConfigured()} />
        </div>
      </form>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-text-muted">{fwd ? `${formatDate(p.from)} to ${formatDate(p.to)}` : `Open invoices as of ${formatDate(p.to)}`}</p>
          <p>
            Amount due <span className="num ml-2 text-lg font-semibold">{formatCents(st.closingCents)}</span>
          </p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Activity</Th>
              <Th>Due</Th>
              <Th numeric>{fwd ? "Amount" : "Open amount"}</Th>
              {fwd && <Th numeric>Balance</Th>}
            </tr>
          </thead>
          <tbody>
            {fwd && (
              <Tr>
                <Td>{formatDate(p.from)}</Td>
                <Td className="text-text-muted">Balance forward</Td>
                <Td />
                <Td />
                <Td numeric>{formatCents(st.openingCents)}</Td>
              </Tr>
            )}
            {st.rows.map((r) => (
              <Tr key={`${r.id}-${r.date}`}>
                <Td>{formatDate(r.date)}</Td>
                <Td>{r.label}</Td>
                <Td>{r.dueDate ? formatDate(r.dueDate) : ""}</Td>
                <Td numeric>{formatCents(r.amountCents)}</Td>
                {fwd && <Td numeric>{formatCents(r.balanceCents)}</Td>}
              </Tr>
            ))}
            {st.rows.length === 0 && (
              <Tr>
                <Td colSpan={fwd ? 5 : 4} className="text-text-muted">
                  {fwd ? "No activity in this period." : "Nothing is open. This customer is paid up."}
                </Td>
              </Tr>
            )}
          </tbody>
        </Table>
        <dl className="grid grid-cols-2 gap-4 border-t border-border px-4 py-3 sm:grid-cols-6" aria-label="Aging">
          {buckets.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-text-muted uppercase">{k}</dt>
              <dd className="num">{formatCents(v)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-text-muted uppercase">Amount due</dt>
            <dd className="num font-semibold">{formatCents(st.closingCents)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
