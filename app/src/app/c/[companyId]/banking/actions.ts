"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query, tx } from "@/db";
import { requireCompany } from "@/lib/authz";
import { addFromFeed, getFeedAccount, importRows, matchExisting, matchOpenDocument, matchTransferPair, undoReview, type AddSpec } from "@/lib/bank/feed";
import { detectFormat, guessColumns, parseCsv, parseOfx, rowsFromCsv, type ColumnMap } from "@/lib/bank/parse";
import { PostingError } from "@/lib/posting";
import { UserError } from "@/lib/txn/save";
import type { ActionResult } from "../actions";

function fail(e: unknown): ActionResult<never> {
  if (e instanceof UserError || e instanceof PostingError) return { ok: false, error: e.message };
  const pg = e as { code?: string; message?: string };
  if (pg.code === "23514" && pg.message?.includes("closed period")) return { ok: false, error: "That date is in a closed period. Reopen the books in Settings to change it." };
  if (pg.code === "23514" && pg.message?.includes("reconciled")) return { ok: false, error: "That transaction is reconciled. Undo the reconciliation first." };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

const done = (companyId: string) => revalidatePath(`/c/${companyId}`, "layout");

export async function linkFeedAccountAction(companyId: string, accountId: string): Promise<ActionResult<{ id: string }>> {
  await requireCompany(companyId, "admin");
  const a = await one<{ type: string }>("select type from accounts where company_id = $1 and id = $2 and active", [companyId, accountId]);
  if (!a || !["bank", "credit_card"].includes(a.type)) return { ok: false, error: "Choose a bank or credit card account." };
  const row = await one<{ id: string }>(
    `insert into bank_feed_accounts (company_id, account_id) values ($1, $2)
     on conflict (company_id, account_id) do update set updated_at = now() returning id`,
    [companyId, accountId],
  );
  done(companyId);
  return { ok: true, data: { id: row!.id } };
}

const MAX_FILE = 5 * 1024 * 1024;

export async function previewImportAction(companyId: string, fileName: string, text: string) {
  await requireCompany(companyId, "standard");
  if (text.length > MAX_FILE) return { ok: false as const, error: "That file is over 5 MB. Split it into smaller date ranges." };
  const format = detectFormat(fileName, text);
  if (format !== "csv") {
    const r = parseOfx(text);
    return { ok: true as const, format, rows: r.rows.slice(0, 8), total: r.rows.length, errors: r.errors.slice(0, 5), table: null, map: null };
  }
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false as const, error: "That file is empty." };
  const map = guessColumns(table);
  const r = rowsFromCsv(table, map);
  return { ok: true as const, format, rows: r.rows.slice(0, 8), total: r.rows.length, errors: r.errors.slice(0, 5), table: table.slice(0, 6), map };
}

export async function csvPreviewWithMapAction(companyId: string, text: string, map: ColumnMap) {
  await requireCompany(companyId, "standard");
  const r = rowsFromCsv(parseCsv(text), map);
  return { rows: r.rows.slice(0, 8), total: r.rows.length, errors: r.errors.slice(0, 5) };
}

export async function commitImportAction(
  companyId: string,
  feedAccountId: string,
  fileName: string,
  text: string,
  map: ColumnMap | null,
): Promise<ActionResult<{ added: number; duplicates: number; autoAdded: number }>> {
  const ctx = await requireCompany(companyId, "standard");
  if (text.length > MAX_FILE) return { ok: false, error: "That file is over 5 MB." };
  const format = detectFormat(fileName, text);
  const parsed = format === "csv" ? rowsFromCsv(parseCsv(text), map ?? guessColumns(parseCsv(text))) : parseOfx(text);
  if (parsed.rows.length === 0) return { ok: false, error: parsed.errors[0]?.message ?? "No transactions found in that file." };
  try {
    const r = await tx((db) => importRows(db, companyId, ctx.userId, feedAccountId, { name: fileName, format, columnMap: map }, parsed.rows, parsed.ledgerBalanceCents));
    done(companyId);
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

const specSchema = z.object({
  kind: z.enum(["categorize", "transfer"]),
  contactId: z.string().uuid().nullish(),
  memo: z.string().max(4000).nullish(),
  lines: z.array(z.object({ accountId: z.string().uuid(), amountCents: z.number().int(), description: z.string().max(4000).nullish() })).optional(),
  otherAccountId: z.string().uuid().nullish(),
  ruleId: z.string().uuid().nullish(),
});

export async function addFeedTxnAction(companyId: string, rowId: string, raw: unknown): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  const spec = specSchema.safeParse(raw);
  if (!spec.success) return { ok: false, error: "Choose a category." };
  try {
    await tx(async (db) => {
      const r = await one<{ feed_account_id: string }>("select feed_account_id from bank_feed_txns where company_id = $1 and id = $2", [companyId, rowId], db);
      if (!r) throw new UserError("That bank transaction no longer exists.");
      await addFromFeed(db, companyId, ctx.userId, await getFeedAccount(db, companyId, r.feed_account_id), rowId, spec.data as AddSpec);
    });
    done(companyId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function matchFeedTxnAction(companyId: string, rowId: string, target: { kind: "match" | "invoice" | "bill" | "transfer"; txnId: string }): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    await tx(async (db) => {
      const r = await one<{ feed_account_id: string }>("select feed_account_id from bank_feed_txns where company_id = $1 and id = $2", [companyId, rowId], db);
      if (!r) throw new UserError("That bank transaction no longer exists.");
      const feed = await getFeedAccount(db, companyId, r.feed_account_id);
      if (target.kind === "match") await matchExisting(db, companyId, ctx.userId, feed, rowId, target.txnId);
      else if (target.kind === "transfer") await matchTransferPair(db, companyId, ctx.userId, feed, rowId, target.txnId);
      else await matchOpenDocument(db, companyId, ctx.userId, feed, rowId, target.txnId);
    });
    done(companyId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/** Accept every selected row that has a rule suggestion, in one go. Rows without one are skipped. */
export async function batchAcceptAction(companyId: string, rowIds: string[]): Promise<ActionResult<{ accepted: number; skipped: number }>> {
  const ctx = await requireCompany(companyId, "standard");
  let accepted = 0;
  let skipped = 0;
  try {
    for (const id of rowIds) {
      const r = await one<{ feed_account_id: string; suggested: AddSpec | null; status: string }>(
        "select feed_account_id, suggested, status from bank_feed_txns where company_id = $1 and id = $2",
        [companyId, id],
      );
      if (!r || r.status !== "for_review" || !r.suggested) {
        skipped++;
        continue;
      }
      await tx(async (db) => addFromFeed(db, companyId, ctx.userId, await getFeedAccount(db, companyId, r.feed_account_id), id, r.suggested!));
      accepted++;
    }
    done(companyId);
    return { ok: true, data: { accepted, skipped } };
  } catch (e) {
    done(companyId);
    return fail(e);
  }
}

export async function excludeFeedTxnsAction(companyId: string, rowIds: string[]): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  await query(
    "update bank_feed_txns set status = 'excluded', reviewed_by = $3, reviewed_at = now() where company_id = $1 and id = any($2::uuid[]) and status = 'for_review'",
    [companyId, rowIds, ctx.userId],
  );
  done(companyId);
  return { ok: true, data: null };
}

export async function undoFeedTxnAction(companyId: string, rowId: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  try {
    await tx((db) => undoReview(db, companyId, ctx.userId, rowId));
    done(companyId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ rules

const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name the rule.").max(100),
  direction: z.enum(["in", "out", "both"]),
  feedAccountIds: z.array(z.string().uuid()).nullable(),
  matchMode: z.enum(["all", "any"]),
  conditions: z
    .array(z.object({ field: z.enum(["description", "bank_text", "amount"]), op: z.enum(["contains", "not_contains", "equals", "gt", "lt"]), value: z.string().trim().min(1, "Fill in every condition.").max(200) }))
    .min(1, "Add at least one condition."),
  actions: z.object({
    txnType: z.enum(["expense", "deposit", "transfer"]),
    contactId: z.string().uuid().nullish(),
    memo: z.string().max(500).nullish(),
    splits: z.array(z.object({ accountId: z.string().uuid("Choose a category."), percentBp: z.number().int().min(0).max(10000).optional(), amountCents: z.number().int().positive().optional() })).min(1, "Choose a category."),
  }),
  autoConfirm: z.boolean(),
});

export async function saveRuleAction(companyId: string, raw: unknown): Promise<ActionResult<{ id: string; reapplied: number }>> {
  const ctx = await requireCompany(companyId, "standard");
  const parsed = ruleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const r = parsed.data;
  const pct = r.actions.splits.filter((s) => s.amountCents == null);
  if (pct.length > 1 && pct.reduce((a, s) => a + (s.percentBp ?? 0), 0) !== 10000) return { ok: false, error: "Split percentages must add up to 100%." };
  try {
    const row = r.id
      ? await one<{ id: string }>(
          `update bank_rules set name = $3, direction = $4, feed_account_ids = $5, match_mode = $6, conditions = $7, actions = $8, auto_confirm = $9
           where company_id = $1 and id = $2 returning id`,
          [companyId, r.id, r.name, r.direction, r.feedAccountIds, r.matchMode, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.autoConfirm],
        )
      : await one<{ id: string }>(
          `insert into bank_rules (company_id, name, priority, direction, feed_account_ids, match_mode, conditions, actions, auto_confirm)
           values ($1, $2, coalesce((select max(priority) + 1 from bank_rules where company_id = $1), 1), $3, $4, $5, $6, $7, $8) returning id`,
          [companyId, r.name, r.direction, r.feedAccountIds, r.matchMode, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.autoConfirm],
        );
    if (!row) return { ok: false, error: "That rule no longer exists." };
    await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'rule', $3, $4, $5)", [companyId, ctx.userId, row.id, r.id ? "update" : "create", JSON.stringify(r)]);
    const reapplied = await reapplyRules(companyId);
    done(companyId);
    return { ok: true, data: { id: row.id, reapplied } };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, error: "A rule with that name already exists." };
    return fail(e);
  }
}

export async function deleteRuleAction(companyId: string, id: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "standard");
  await query("delete from bank_rules where company_id = $1 and id = $2", [companyId, id]);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action) values ($1, $2, 'rule', $3, 'delete')", [companyId, ctx.userId, id]);
  await reapplyRules(companyId);
  done(companyId);
  return { ok: true, data: null };
}

export async function moveRuleAction(companyId: string, id: string, dir: -1 | 1): Promise<ActionResult<null>> {
  await requireCompany(companyId, "standard");
  await tx(async (db) => {
    const rules = await query<{ id: string }>("select id from bank_rules where company_id = $1 order by priority, created_at for update", [companyId], db);
    const i = rules.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rules.length) return;
    [rules[i], rules[j]] = [rules[j], rules[i]];
    for (const [n, r] of rules.entries()) await query("update bank_rules set priority = $2 where id = $1", [r.id, n + 1], db);
  });
  await reapplyRules(companyId);
  done(companyId);
  return { ok: true, data: null };
}

/** Recompute rule suggestions for everything still waiting for review. */
async function reapplyRules(companyId: string): Promise<number> {
  const { loadRules } = await import("@/lib/bank/feed");
  const { firstMatchingRule, splitAmounts } = await import("@/lib/bank/rules");
  const rules = await loadRules(null, companyId);
  const rows = await query<{ id: string; feed_account_id: string; description: string; bank_text: string | null; amount_cents: number }>(
    "select id, feed_account_id, description, bank_text, amount_cents from bank_feed_txns where company_id = $1 and status = 'for_review'",
    [companyId],
  );
  let n = 0;
  for (const r of rows) {
    const rule = firstMatchingRule(rules, { feedAccountId: r.feed_account_id, description: r.description, bankText: r.bank_text, amountCents: r.amount_cents });
    const suggestion = rule
      ? {
          kind: rule.actions.txnType === "transfer" ? "transfer" : "categorize",
          contactId: rule.actions.contactId ?? null,
          memo: rule.actions.memo ?? null,
          lines: rule.actions.txnType === "transfer" ? undefined : splitAmounts(rule.actions.splits, r.amount_cents),
          otherAccountId: rule.actions.txnType === "transfer" ? rule.actions.splits[0]?.accountId ?? null : null,
          ruleId: rule.id,
        }
      : null;
    await query("update bank_feed_txns set rule_id = $2, suggested = $3 where id = $1", [r.id, rule?.id ?? null, suggestion ? JSON.stringify(suggestion) : null]);
    if (rule) n++;
  }
  return n;
}
