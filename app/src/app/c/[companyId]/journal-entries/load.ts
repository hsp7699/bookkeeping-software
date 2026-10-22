import "server-only";
import { one, query } from "@/db";
import { companyToday, listContactOptions } from "@/lib/queries";
import type { AccountType } from "@/lib/coa";
import type { JournalDetail } from "./journal-form";

export async function loadJournal(companyId: string, id: string | null) {
  const [today, accounts, contacts, initial] = await Promise.all([
    companyToday(companyId),
    query<{ id: string; name: string; type: AccountType }>("select id, name, type from accounts where company_id = $1 and active order by type, lower(name)", [companyId]),
    listContactOptions(companyId, ["customer", "vendor", "employee", "other"]),
    id
      ? one<JournalDetail & { type: string }>(
          `select t.id, t.type, t.number, t.txn_date, t.memo, t.status, t.updated_at::text as updated_at,
                  case when t.type = 'journal_entry' then
                    coalesce((select json_agg(json_build_object('account_id', l.account_id, 'amount_cents', l.amount_cents, 'kind', l.kind,
                      'description', l.description, 'contact_id', l.contact_id) order by l.position) from transaction_lines l where l.transaction_id = t.id), '[]')
                  else
                    -- opening balances have no lines: show their ledger entries
                    coalesce((select json_agg(json_build_object('account_id', e.account_id, 'amount_cents', e.debit_cents + e.credit_cents,
                      'kind', case when e.debit_cents > 0 then 'debit' else 'credit' end, 'description', e.memo, 'contact_id', e.contact_id))
                      from ledger_entries e where e.transaction_id = t.id), '[]')
                  end as lines
           from transactions t where t.company_id = $1 and t.id = $2 and t.type in ('journal_entry','opening_balance')`,
          [companyId, id],
        )
      : null,
  ]);
  return { today, accounts, contacts, initial };
}
