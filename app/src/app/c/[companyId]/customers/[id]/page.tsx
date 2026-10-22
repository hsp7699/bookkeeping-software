import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

const TYPE_LABEL: Record<string, string> = { invoice: "Invoice", payment: "Payment", sales_receipt: "Sales receipt", credit_memo: "Credit memo" };

export default async function CustomerPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await one<{ display_name: string; company_name: string | null; email: string | null; phone: string | null; open_cents: number }>(
    `select c.display_name, c.company_name, c.emails[1] as email, c.phone,
            coalesce((select sum(balance_cents) from transactions t where t.contact_id = c.id and t.type = 'invoice' and t.status = 'posted'), 0) as open_cents
     from contacts c where c.company_id = $1 and c.id = $2 and c.kind = 'customer'`,
    [companyId, id],
  );
  if (!c) notFound();
  const txns = await query<{ id: string; type: string; number: string | null; txn_date: string; total_cents: number; balance_cents: number; status: string }>(
    `select id, type, number, txn_date, total_cents, balance_cents, status from transactions
     where company_id = $1 and contact_id = $2 order by txn_date desc, created_at desc limit 200`,
    [companyId, id],
  );
  const base = `/c/${companyId}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`${base}/customers`} className="text-sm text-accent hover:underline">
            ← Customers
          </Link>
          <h1 className="mt-1 text-xl font-bold">{c.display_name}</h1>
          <p className="text-text-muted">{[c.company_name, c.email, c.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-text-muted">Open balance</p>
            <p className="num text-lg font-semibold">{formatCents(c.open_cents)}</p>
          </div>
          <Button asChild>
            <Link href={`${base}/payments/new?customer=${id}`}>Receive payment</Link>
          </Button>
          <Button asChild variant="primary">
            <Link href={`${base}/invoices/new?customer=${id}`}>New invoice</Link>
          </Button>
        </div>
      </div>
      <Card>
        {txns.length === 0 ? (
          <p className="p-8 text-center text-text-muted">No transactions with this customer yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>No.</Th>
                <Th numeric>Total</Th>
                <Th numeric>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <Tr key={t.id}>
                  <Td>{formatDate(t.txn_date)}</Td>
                  <Td>{TYPE_LABEL[t.type] ?? t.type}</Td>
                  <Td>
                    {t.type === "invoice" ? (
                      <Link className="text-accent hover:underline" href={`${base}/invoices/${t.id}`}>
                        {t.number}
                      </Link>
                    ) : (
                      t.number
                    )}
                  </Td>
                  <Td numeric>{formatCents(t.total_cents)}</Td>
                  <Td numeric>{t.type === "invoice" ? formatCents(t.balance_cents) : ""}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
