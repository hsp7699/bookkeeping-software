import Link from "next/link";
import { notFound } from "next/navigation";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

export default async function BillPaymentPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await one<{ vendor: string; vendor_id: string; txn_date: string; account: string; number: string | null; total_cents: number; status: string }>(
    `select c.display_name as vendor, c.id as vendor_id, t.txn_date, a.name as account, t.number, t.total_cents, t.status
     from transactions t join contacts c on c.id = t.contact_id join accounts a on a.id = t.account_id
     where t.company_id = $1 and t.id = $2 and t.type = 'bill_payment'`,
    [companyId, id],
  );
  if (!p) notFound();
  const bills = await query<{ id: string; number: string | null; txn_date: string; total_cents: number; amount_cents: number }>(
    `select b.id, b.number, b.txn_date, b.total_cents, a.amount_cents
     from payment_applications a join transactions b on b.id = a.target_txn_id where a.source_txn_id = $1 order by b.txn_date`,
    [id],
  );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/c/${companyId}/expenses?type=bill_payment`} className="text-sm text-accent hover:underline">
          ← Bill payments
        </Link>
        <h1 className="mt-1 flex items-center gap-3 text-xl font-bold">
          Bill payment {p.number}
          {p.status === "voided" && <StatusPill tone="voided">Voided</StatusPill>}
        </h1>
        <p className="text-text-muted">
          To{" "}
          <Link className="text-accent hover:underline" href={`/c/${companyId}/vendors/${p.vendor_id}`}>
            {p.vendor}
          </Link>{" "}
          from {p.account} on {formatDate(p.txn_date)} · {formatCents(p.total_cents)}
        </p>
      </div>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Bill</Th>
              <Th>Bill date</Th>
              <Th numeric>Bill total</Th>
              <Th numeric>Paid</Th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <Tr key={b.id}>
                <Td>
                  <Link className="text-accent hover:underline" href={`/c/${companyId}/bills/${b.id}`}>
                    {b.number ?? "Bill"}
                  </Link>
                </Td>
                <Td>{formatDate(b.txn_date)}</Td>
                <Td numeric>{formatCents(b.total_cents)}</Td>
                <Td numeric>{formatCents(b.amount_cents)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div>
        <TxnMoreMenu companyId={companyId} txnId={id} label="bill payment" voided={p.status === "voided"} afterDelete={`/c/${companyId}/expenses`} />
      </div>
    </div>
  );
}
