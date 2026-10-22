import Link from "next/link";
import { notFound } from "next/navigation";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { Card } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { JournalForm } from "../journal-form";
import { loadJournal } from "../load";

export default async function JournalPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  await requireCompany(companyId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await loadJournal(companyId, id);
  if (!d.initial) notFound();
  if (d.initial.type === "opening_balance") {
    // Opening balances are made from the account form; here they can be reviewed or deleted.
    const names = new Map(d.accounts.map((a) => [a.id, a.name]));
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <Link href={`/c/${companyId}/accounts`} className="text-sm text-accent hover:underline">
          ← Chart of accounts
        </Link>
        <h1 className="text-xl font-bold">Opening balance · {formatDate(d.initial.txn_date)}</h1>
        <Card className="p-4">
          {d.initial.lines.map((l, i) => (
            <p key={i} className="flex justify-between py-1">
              <span>
                {names.get(l.account_id)} <span className="text-text-muted">({l.kind})</span>
              </span>
              <span className="num">{formatCents(l.amount_cents)}</span>
            </p>
          ))}
        </Card>
        <div>
          <TxnMoreMenu companyId={companyId} txnId={id} label="opening balance" voided afterDelete={`/c/${companyId}/accounts`} />
        </div>
      </div>
    );
  }
  return <JournalForm key={d.initial.updated_at} companyId={companyId} {...d} />;
}
