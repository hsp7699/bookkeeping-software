import { Landmark } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { suggestionsFor, type FeedAccount } from "@/lib/bank/feed";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { listCategoryAccounts, listContactOptions } from "@/lib/queries";
import { TXN_LABEL, txnHref } from "@/lib/routes";
import { BankFeed, type FeedRow } from "./bank-feed";
import { ImportButton, LinkAccountForm } from "./import-dialog";

const TABS = [
  ["review", "For review"],
  ["categorized", "Categorized"],
  ["excluded", "Excluded"],
] as const;

export default async function BankingPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ account?: string; tab?: string }>;
}) {
  const { companyId } = await params;
  const sp = await searchParams;
  await requireCompany(companyId, "standard");
  const base = `/c/${companyId}/banking`;

  const feeds = await query<FeedAccount & { last_balance_cents: number | null; last_synced_at: Date | null; books_cents: number; to_review: number }>(
    `select f.id, f.account_id, a.name, a.type, f.last_balance_cents, f.last_synced_at,
            coalesce((select sum(e.debit_cents - e.credit_cents) from ledger_entries e where e.account_id = a.id), 0)::bigint
              * case when a.type = 'credit_card' then -1 else 1 end as books_cents,
            (select count(*) from bank_feed_txns b where b.feed_account_id = f.id and b.status = 'for_review')::int as to_review
     from bank_feed_accounts f join accounts a on a.id = f.account_id
     where f.company_id = $1 and a.active order by a.type, lower(a.name)`,
    [companyId],
  );
  const unlinked = await query<{ id: string; name: string; type: string }>(
    `select id, name, type from accounts a where company_id = $1 and active and type in ('bank','credit_card')
       and not exists (select 1 from bank_feed_accounts f where f.account_id = a.id) order by type, lower(name)`,
    [companyId],
  );

  if (feeds.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-bold">Bank transactions</h1>
        <Card>
          <EmptyState
            icon={Landmark}
            title="Bring in your bank transactions"
            body="Pick the bank or credit card account in your books, then import a CSV, OFX, QFX or QBO file downloaded from your bank's website."
          />
          <div className="flex justify-center pb-10">
            <LinkAccountForm companyId={companyId} accounts={unlinked} />
          </div>
        </Card>
      </div>
    );
  }

  const feed = feeds.find((f) => f.id === sp.account) ?? feeds[0];
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "review") as (typeof TABS)[number][0];
  const status = tab === "review" ? "for_review" : tab;

  const [rows, categories, contacts, transferAccounts] = await Promise.all([
    query<{
      id: string;
      posted_date: string;
      description: string;
      bank_text: string | null;
      amount_cents: number;
      status: string;
      suggested: FeedRow["suggested"];
      rule_name: string | null;
      txn_id: string | null;
      txn_type: string | null;
      txn_number: string | null;
      matched: boolean;
      category: string | null;
    }>(
      `select b.id, b.posted_date, b.description, b.bank_text, b.amount_cents, b.status, b.suggested, r.name as rule_name,
              coalesce(b.created_txn_id, b.matched_txn_id) as txn_id, t.type as txn_type, t.number as txn_number, b.matched_txn_id is not null as matched,
              (select case when count(*) > 1 then '-Split-' else max(a.name) end from transaction_lines l join accounts a on a.id = l.account_id where l.transaction_id = t.id) as category
       from bank_feed_txns b
       left join bank_rules r on r.id = b.rule_id
       left join transactions t on t.id = coalesce(b.created_txn_id, b.matched_txn_id)
       where b.feed_account_id = $1 and b.status = $2
       order by b.posted_date desc, b.created_at desc limit 500`,
      [feed.id, status],
    ),
    listCategoryAccounts(companyId),
    listContactOptions(companyId, ["vendor", "customer", "employee", "other"]),
    query<{ id: string; name: string; type: string }>(
      "select id, name, type from accounts where company_id = $1 and active and type in ('bank','credit_card','other_current_asset','other_current_liability','long_term_liability','equity') and id <> $2 order by type, lower(name)",
      [companyId, feed.account_id],
    ),
  ]);
  const suggestions = tab === "review" ? await suggestionsFor(companyId, feed, rows) : new Map();

  const feedRows: FeedRow[] = rows.map((r) => ({
    id: r.id,
    date: r.posted_date,
    description: r.description,
    bankText: r.bank_text,
    amountCents: r.amount_cents,
    status: r.status,
    suggested: r.suggested,
    ruleName: r.rule_name,
    suggestions: suggestions.get(r.id) ?? [],
    result: r.txn_id
      ? { label: `${r.matched ? "Matched: " : ""}${TXN_LABEL[r.txn_type ?? ""] ?? "Transaction"}${r.txn_number ? ` ${r.txn_number}` : ""}`, href: txnHref(companyId, r.txn_type ?? "", r.txn_id), category: r.category }
      : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Bank transactions</h1>
        <div className="flex items-center gap-2">
          <Link href={`${base}/rules`} className="text-accent hover:underline">
            Rules
          </Link>
          <ImportButton companyId={companyId} feedAccountId={feed.id} accountName={feed.name} />
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {feeds.map((f) => (
          <Link
            key={f.id}
            href={`${base}?account=${f.id}`}
            aria-current={f.id === feed.id ? "true" : undefined}
            className={cn("min-w-60 rounded-lg border bg-bg p-4 shadow-card hover:border-accent", f.id === feed.id ? "border-accent ring-1 ring-accent" : "border-border")}
          >
            <p className="font-semibold">{f.name}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 text-sm">
              <dt className="text-text-muted">Bank balance</dt>
              <dd className="num">{f.last_balance_cents != null ? formatCents(f.last_balance_cents) : "—"}</dd>
              <dt className="text-text-muted">In Books</dt>
              <dd className="num">{formatCents(f.books_cents)}</dd>
            </dl>
            <p className={cn("mt-2 text-sm font-medium", f.to_review ? "text-accent" : "text-text-muted")}>{f.to_review ? `${f.to_review} to review` : "All caught up"}</p>
          </Link>
        ))}
        {unlinked.length > 0 && (
          <div className="flex min-w-60 items-center justify-center rounded-lg border border-dashed border-border-input p-4">
            <LinkAccountForm companyId={companyId} accounts={unlinked} compact />
          </div>
        )}
      </div>

      <nav aria-label="Review status" className="flex gap-1 border-b border-border">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`${base}?account=${feed.id}${k === "review" ? "" : `&tab=${k}`}`}
            aria-current={tab === k ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 font-medium", tab === k ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text")}
          >
            {label}
            {k === "review" && feed.to_review ? <span className="ml-2 rounded-pill bg-accent-soft px-2 text-xs text-on-accent-soft">{feed.to_review}</span> : null}
          </Link>
        ))}
      </nav>

      <BankFeed
        key={`${feed.id}-${tab}`}
        companyId={companyId}
        tab={tab}
        accountType={feed.type}
        rows={feedRows}
        categories={categories}
        contacts={contacts}
        transferAccounts={transferAccounts}
      />
    </div>
  );
}
