import "server-only";
import { one } from "@/db";
import { companyToday, listAccountsByType } from "@/lib/queries";
import type { TransferDetail } from "./transfer-form";

export async function loadTransfer(companyId: string, id: string | null) {
  const [today, accounts, initial] = await Promise.all([
    companyToday(companyId),
    listAccountsByType(companyId, ["bank", "credit_card", "other_current_asset", "other_current_liability", "long_term_liability", "equity"]),
    id
      ? one<TransferDetail>(
          `select t.id, t.txn_date, t.account_id, t.total_cents, t.memo, t.status, t.updated_at::text as updated_at,
                  (select e.account_id from ledger_entries e where e.transaction_id = t.id and e.credit_cents > 0 limit 1) as from_account_id
           from transactions t where t.company_id = $1 and t.id = $2 and t.type = 'transfer'`,
          [companyId, id],
        )
      : null,
  ]);
  return { today, accounts: accounts.filter((a) => a.system_role !== "undeposited_funds"), initial };
}
