import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { ACCOUNT_TYPE_LABELS, DEBIT_NORMAL, type AccountType } from "@/lib/coa";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TXN_LABEL, txnHref } from "@/lib/routes";

const COLUMNS: Partial<Record<AccountType, [string, string]>> = {
  // [debit column, credit column]
  bank: ["Deposit", "Payment"],
  credit_card: ["Payment", "Charge"],
  accounts_receivable: ["Charge", "Payment"],
  accounts_payable: ["Payment", "Billed"],
};

const PAGE = 200;

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { companyId, id } = await params;
  const { page: pageStr } = await searchParams;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const account = await one<{ name: string; type: AccountType }>("select name, type from accounts where company_id = $1 and id = $2", [companyId, id]);
  if (!account) notFound();
  const page = Math.max(0, Number(pageStr) || 0);
  const sign = DEBIT_NORMAL.has(account.type) ? 1 : -1;

  // Newest first, running balance computed over the whole history.
  const rows = await query<{
    id: string;
    transaction_id: string;
    type: string;
    number: string | null;
    entry_date: string;
    payee: string | null;
    memo: string | null;
    debit_cents: number;
    credit_cents: number;
    reconcile_status: string;
    balance: number;
    total: number;
  }>(
    `select * from (
       select e.id, e.transaction_id, t.type, t.number, e.entry_date, c.display_name as payee, coalesce(e.memo, t.memo) as memo,
              e.debit_cents, e.credit_cents, e.reconcile_status,
              sum(e.debit_cents - e.credit_cents) over (order by e.entry_date, e.created_at, e.id rows unbounded preceding) as balance,
              count(*) over () as total
       from ledger_entries e
       join transactions t on t.id = e.transaction_id
       left join contacts c on c.id = coalesce(e.contact_id, t.contact_id)
       where e.company_id = $1 and e.account_id = $2
     ) r order by entry_date desc, balance desc
     limit ${PAGE} offset $3`,
    [companyId, id, page * PAGE],
  );
  const total = rows[0]?.total ?? 0;
  const [dr, cr] = COLUMNS[account.type] ?? (DEBIT_NORMAL.has(account.type) ? ["Increase", "Decrease"] : ["Decrease", "Increase"]);
  const showRec = account.type === "bank" || account.type === "credit_card";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/c/${companyId}/accounts`} className="text-sm text-accent hover:underline">
          ← Chart of accounts
        </Link>
        <h1 className="mt-1 text-xl font-bold">{account.name} register</h1>
        <p className="text-text-muted">{ACCOUNT_TYPE_LABELS[account.type]}</p>
      </div>
      <Card>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-text-muted">Nothing has been recorded in this account yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>No.</Th>
                <Th>Payee</Th>
                <Th>Memo</Th>
                <Th numeric>{dr}</Th>
                <Th numeric>{cr}</Th>
                {showRec && (
                  <Th>
                    <abbr title="Reconcile status: C cleared, R reconciled">✓</abbr>
                  </Th>
                )}
                <Th numeric>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDate(r.entry_date)}</Td>
                  <Td>
                    <Link className="text-accent hover:underline" href={txnHref(companyId, r.type, r.transaction_id)}>
                      {TXN_LABEL[r.type] ?? r.type}
                    </Link>
                  </Td>
                  <Td>{r.number}</Td>
                  <Td>{r.payee}</Td>
                  <Td className="max-w-xs truncate text-text-muted">{r.memo}</Td>
                  <Td numeric>{r.debit_cents ? formatCents(r.debit_cents) : ""}</Td>
                  <Td numeric>{r.credit_cents ? formatCents(r.credit_cents) : ""}</Td>
                  {showRec && <Td className="text-center font-semibold">{r.reconcile_status === "reconciled" ? "R" : r.reconcile_status === "cleared" ? "C" : ""}</Td>}
                  <Td numeric className={cn(r.balance * sign < 0 && "text-negative-amount")}>
                    {formatCents(r.balance * sign)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {total > PAGE && (
        <nav className="flex justify-between" aria-label="Register pages">
          {page > 0 ? <Link href={`?page=${page - 1}`} className="text-accent hover:underline">← Newer</Link> : <span />}
          {(page + 1) * PAGE < total ? <Link href={`?page=${page + 1}`} className="text-accent hover:underline">Older →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
