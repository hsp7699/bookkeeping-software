import "server-only";
import { one, query } from "@/db";
import { companyToday, listAccountsByType, listCategoryAccounts } from "@/lib/queries";
import type { DepositDetail, Undeposited } from "./deposit-form";

export async function loadDeposit(companyId: string, id: string | null) {
  const [today, banks, categories, payments, initial] = await Promise.all([
    companyToday(companyId),
    listAccountsByType(companyId, ["bank"]),
    listCategoryAccounts(companyId),
    // Undeposited payments and sales receipts, plus the ones already in this deposit
    query<Undeposited>(
      `select t.id, t.type, t.txn_date, c.display_name as customer, t.payment_method, t.number, t.total_cents
       from transactions t
       join accounts a on a.id = t.account_id and a.system_role = 'undeposited_funds'
       left join contacts c on c.id = t.contact_id
       left join deposit_items d on d.source_txn_id = t.id
       where t.company_id = $1 and t.type in ('payment','sales_receipt') and t.status = 'posted'
         and (d.deposit_txn_id is null or d.deposit_txn_id = $2::uuid)
       order by t.txn_date, t.created_at`,
      [companyId, id],
    ),
    id
      ? one<DepositDetail>(
          `select t.id, t.txn_date, t.account_id, t.memo, t.status, t.updated_at::text as updated_at,
                  coalesce((select array_agg(d.source_txn_id) from deposit_items d where d.deposit_txn_id = t.id), '{}') as source_ids,
                  coalesce((select json_agg(json_build_object('account_id', l.account_id, 'description', l.description, 'amount_cents', l.amount_cents) order by l.position)
                            from transaction_lines l where l.transaction_id = t.id), '[]') as lines
           from transactions t where t.company_id = $1 and t.id = $2 and t.type = 'deposit'`,
          [companyId, id],
        )
      : null,
  ]);
  return { today, banks, categories, payments, initial };
}
