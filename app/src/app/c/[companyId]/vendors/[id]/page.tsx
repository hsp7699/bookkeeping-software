import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { listTerms } from "@/lib/queries";
import { TXN_LABEL, txnHref } from "@/lib/routes";
import { EditVendorButton } from "../vendor-buttons";

export default async function VendorPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await one<{
    display_name: string;
    company_name: string | null;
    email: string | null;
    phone: string | null;
    terms_id: string | null;
    billing_address: Record<string, string>;
    notes: string | null;
    track_1099: boolean;
    tax_id: string | null;
    open_cents: number;
  }>(
    `select c.display_name, c.company_name, c.emails[1] as email, c.phone, c.terms_id, c.billing_address, c.notes, c.track_1099, c.tax_id,
            coalesce((select sum(balance_cents) from transactions t where t.contact_id = c.id and t.type = 'bill' and t.status = 'posted'), 0) as open_cents
     from contacts c where c.company_id = $1 and c.id = $2 and c.kind = 'vendor'`,
    [companyId, id],
  );
  if (!v) notFound();
  const [terms, txns] = await Promise.all([
    listTerms(companyId),
    query<{ id: string; type: string; number: string | null; txn_date: string; due_date: string | null; total_cents: number; balance_cents: number; status: string }>(
      `select id, type, number, txn_date, due_date, total_cents, balance_cents, status from transactions
       where company_id = $1 and contact_id = $2 order by txn_date desc, created_at desc limit 200`,
      [companyId, id],
    ),
  ]);
  const base = `/c/${companyId}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`${base}/vendors`} className="text-sm text-accent hover:underline">
            ← Vendors
          </Link>
          <h1 className="mt-1 text-xl font-bold">{v.display_name}</h1>
          <p className="text-text-muted">{[v.company_name, v.email, v.phone, v.track_1099 ? "1099 vendor" : null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-text-muted">Open balance</p>
            <p className="num text-lg font-semibold">{formatCents(v.open_cents)}</p>
          </div>
          <EditVendorButton
            companyId={companyId}
            terms={terms}
            vendor={{
              id,
              displayName: v.display_name,
              companyName: v.company_name ?? undefined,
              email: v.email ?? undefined,
              phone: v.phone ?? undefined,
              termsId: v.terms_id ?? undefined,
              billingAddress: v.billing_address,
              notes: v.notes ?? undefined,
              track1099: v.track_1099,
              taxId: v.tax_id ?? undefined,
            }}
          />
          <Button asChild>
            <Link href={`${base}/bills/pay?vendor=${id}`}>Pay bills</Link>
          </Button>
          <Button asChild variant="primary">
            <Link href={`${base}/bills/new?vendor=${id}`}>New bill</Link>
          </Button>
        </div>
      </div>
      <Card>
        {txns.length === 0 ? (
          <p className="p-8 text-center text-text-muted">No transactions with this vendor yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>No.</Th>
                <Th>Due date</Th>
                <Th numeric>Total</Th>
                <Th numeric>Open balance</Th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <Tr key={t.id}>
                  <Td>{formatDate(t.txn_date)}</Td>
                  <Td>
                    <Link className="text-accent hover:underline" href={txnHref(companyId, t.type, t.id)}>
                      {TXN_LABEL[t.type] ?? t.type}
                    </Link>
                    {t.status === "voided" && <span className="ml-2 text-sm text-text-muted">(voided)</span>}
                  </Td>
                  <Td>{t.number}</Td>
                  <Td>{t.due_date ? formatDate(t.due_date) : ""}</Td>
                  <Td numeric>{formatCents(t.total_cents)}</Td>
                  <Td numeric>{t.type === "bill" ? formatCents(t.balance_cents) : ""}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
