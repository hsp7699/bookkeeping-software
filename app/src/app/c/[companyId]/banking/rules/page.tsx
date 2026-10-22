import Link from "next/link";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { listCategoryAccounts, listContactOptions } from "@/lib/queries";
import { RulesClient, type RuleRow } from "./rules-client";

export default async function RulesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId, "standard");
  const [rules, categories, contacts, feeds] = await Promise.all([
    query<RuleRow>(
      `select id, name, priority, direction, feed_account_ids, match_mode, conditions, actions, auto_confirm,
              (select count(*) from bank_feed_txns b where b.rule_id = r.id and b.status = 'for_review')::int as pending,
              (select count(*) from bank_feed_txns b where b.rule_id = r.id and b.status = 'categorized')::int as applied
       from bank_rules r where company_id = $1 order by priority, created_at`,
      [companyId],
    ),
    listCategoryAccounts(companyId),
    listContactOptions(companyId, ["vendor", "customer", "employee", "other"]),
    query<{ id: string; name: string }>("select f.id, a.name from bank_feed_accounts f join accounts a on a.id = f.account_id where f.company_id = $1 order by lower(a.name)", [companyId]),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/c/${companyId}/banking`} className="text-sm text-accent hover:underline">
          ← Bank transactions
        </Link>
        <h1 className="mt-1 text-xl font-bold">Bank rules</h1>
        <p className="text-text-muted">Rules run top to bottom; the first one that matches a bank transaction wins.</p>
      </div>
      <RulesClient companyId={companyId} rules={rules} categories={categories} contacts={contacts} feedAccounts={feeds} />
    </div>
  );
}
