import Link from "next/link";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents, parseMoney } from "@/lib/money";
import { TXN_LABEL, txnHref } from "@/lib/routes";

export default async function SearchPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { companyId } = await params;
  const { q = "" } = await searchParams;
  await requireCompany(companyId);
  const term = q.trim().slice(0, 100);
  const amount = term ? parseMoney(term) : null;
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const [contacts, txns] = term
    ? await Promise.all([
        query<{ id: string; kind: string; display_name: string; email: string | null }>(
          `select id, kind, display_name, emails[1] as email from contacts
           where company_id = $1 and (display_name ilike $2 or company_name ilike $2 or array_to_string(emails, ' ') ilike $2)
           order by lower(display_name) limit 20`,
          [companyId, like],
        ),
        query<{ id: string; type: string; number: string | null; txn_date: string; contact: string | null; total_cents: number; memo: string | null }>(
          `select t.id, t.type, t.number, t.txn_date, c.display_name as contact, t.total_cents, t.memo
           from transactions t left join contacts c on c.id = t.contact_id
           where t.company_id = $1 and (t.number ilike $2 or t.memo ilike $2 or t.private_note ilike $2 or c.display_name ilike $2
                 or ($3::bigint is not null and (t.total_cents = abs($3) or exists (select 1 from transaction_lines l where l.transaction_id = t.id and abs(l.amount_cents) = abs($3)))))
           order by t.txn_date desc limit 100`,
          [companyId, like, amount],
        ),
      ])
    : [[], []];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">{term ? `Results for “${term}”` : "Search"}</h1>
      {!term && <p className="text-text-muted">Search by name, number, memo or amount.</p>}
      {term && contacts.length === 0 && txns.length === 0 && <p className="text-text-muted">Nothing matches. Try part of a name, an invoice number or an amount like 1250.00.</p>}
      {contacts.length > 0 && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Email</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link className="text-accent hover:underline" href={`/c/${companyId}/${c.kind === "vendor" ? "vendors" : "customers"}/${c.id}`}>
                      {c.display_name}
                    </Link>
                  </Td>
                  <Td className="capitalize">{c.kind}</Td>
                  <Td>{c.email}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {txns.length > 0 && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>No.</Th>
                <Th>Name</Th>
                <Th>Memo</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <Tr key={t.id}>
                  <Td>{formatDate(t.txn_date)}</Td>
                  <Td>
                    <Link className="text-accent hover:underline" href={txnHref(companyId, t.type, t.id)}>
                      {TXN_LABEL[t.type]}
                    </Link>
                  </Td>
                  <Td>{t.number}</Td>
                  <Td>{t.contact}</Td>
                  <Td className="max-w-xs truncate text-text-muted">{t.memo}</Td>
                  <Td numeric>{formatCents(t.total_cents)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
