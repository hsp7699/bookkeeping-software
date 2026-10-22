import "server-only";
import type { PoolClient } from "pg";
import { one, query } from "@/db";
import { DEFAULT_TERMS, seedAccounts, type EntityType } from "@/lib/coa";

export interface NewCompany {
  name: string;
  entityType: EntityType;
  fiscalYearStartMonth: number;
  accountingMethod: "accrual" | "cash";
  timezone: string;
}

/** Create a company with its owner, default chart of accounts, terms and number sequences. */
export async function createCompany(db: PoolClient, ownerId: string, c: NewCompany): Promise<string> {
  const company = await one<{ id: string }>(
    `insert into companies (name, entity_type, fiscal_year_start_month, accounting_method, timezone)
     values ($1, $2, $3, $4, $5) returning id`,
    [c.name, c.entityType, c.fiscalYearStartMonth, c.accountingMethod, c.timezone],
    db,
  );
  const id = company!.id;
  await query(`insert into memberships (company_id, user_id, role) values ($1, $2, 'owner')`, [id, ownerId], db);
  for (const a of seedAccounts(c.entityType)) {
    await query(`insert into accounts (company_id, name, type, detail_type, system_role) values ($1, $2, $3, $4, $5)`, [id, a.name, a.type, a.detail, a.role ?? null], db);
  }
  for (const t of DEFAULT_TERMS) {
    await query(`insert into terms (company_id, name, due_days) values ($1, $2, $3)`, [id, t.name, t.dueDays], db);
  }
  await query(
    `insert into number_sequences (company_id, type, next_value) values ($1, 'invoice', 1001), ($1, 'sales_receipt', 1001),
     ($1, 'credit_memo', 1001), ($1, 'refund_receipt', 1001), ($1, 'journal_entry', 1)`,
    [id],
    db,
  );
  await query(
    `insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'company', $1, 'create', $3)`,
    [id, ownerId, JSON.stringify(c)],
    db,
  );
  return id;
}
