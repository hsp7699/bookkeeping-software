import Link from "next/link";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { listAccountsByType, listCategoryAccounts } from "@/lib/queries";
import { receiptMatches } from "@/lib/receipts";
import { txnHref, TXN_LABEL } from "@/lib/routes";
import { ReceiptInbox, type ReceiptRow } from "./receipt-inbox";

export default async function ReceiptsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const [review, done, payAccounts, categories, vendors] = await Promise.all([
    query<Omit<ReceiptRow, "matches">>(
      `select r.id, r.attachment_id, a.file_name, a.content_type, r.vendor_name, r.txn_date::text, r.amount_cents
       from receipts r join attachments a on a.id = r.attachment_id where r.company_id = $1 and r.status = 'review' order by r.created_at desc`,
      [companyId],
    ),
    query<{ id: string; file_name: string; status: string; txn_id: string | null; type: string | null; number: string | null; txn_date: string | null; total_cents: number | null; contact: string | null }>(
      `select r.id, a.file_name, r.status, r.txn_id, t.type, t.number, t.txn_date::text, t.total_cents, c.display_name as contact
       from receipts r join attachments a on a.id = r.attachment_id left join transactions t on t.id = r.txn_id left join contacts c on c.id = t.contact_id
       where r.company_id = $1 and r.status <> 'review' order by r.updated_at desc limit 50`,
      [companyId],
    ),
    listAccountsByType(companyId, ["bank", "credit_card"]),
    listCategoryAccounts(companyId),
    query<{ display_name: string }>("select display_name from contacts where company_id = $1 and kind = 'vendor' and active order by lower(display_name)", [companyId]),
  ]);
  const matches = await receiptMatches(companyId, review);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Receipts</h1>
        <p className="mt-1 text-text-muted">Upload receipts as you get them. Fill in who, when and how much, then attach each one to a transaction or record it as a new expense.</p>
      </div>
      <ReceiptInbox
        companyId={companyId}
        rows={review.map((r) => ({ ...r, matches: matches.get(r.id) ?? [] }))}
        payAccounts={payAccounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.filter((a) => ["expense", "cost_of_goods_sold", "other_expense", "fixed_asset"].includes(a.type)).map((a) => ({ id: a.id, name: a.name }))}
        vendors={vendors.map((v) => v.display_name)}
      />
      {done.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Reviewed</h2>
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Attached to</Th>
                  <Th>Date</Th>
                  <Th numeric>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {done.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.file_name}</Td>
                    <Td>
                      {r.txn_id && r.type ? (
                        <Link className="text-accent hover:underline" href={txnHref(companyId, r.type, r.txn_id)}>
                          {TXN_LABEL[r.type]}
                          {r.number ? ` ${r.number}` : ""}
                          {r.contact ? ` · ${r.contact}` : ""}
                        </Link>
                      ) : (
                        <span className="text-text-muted">Transaction deleted</span>
                      )}
                      {r.status === "created" && <span className="text-text-muted"> (created from the receipt)</span>}
                    </Td>
                    <Td>{r.txn_date ? formatDate(r.txn_date) : ""}</Td>
                    <Td numeric>{r.total_cents != null ? formatCents(r.total_cents) : ""}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </section>
      )}
    </div>
  );
}
