"use server";

import { hash } from "@node-rs/argon2";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { one, query, tx } from "@/db";
import { DEFAULT_TERMS, seedAccounts, type EntityType } from "@/lib/coa";
import { requireUser } from "@/lib/authz";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

function fieldErrors(e: z.ZodError) {
  return Object.fromEntries(e.issues.map((i) => [String(i.path[0]), i.message]));
}

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { name, email, password } = parsed.data;
  const exists = await one("select 1 from users where email = $1", [email]);
  if (exists) return { fieldErrors: { email: "An account with this email already exists. Sign in instead." } };
  await query("insert into users (email, name, password_hash) values ($1, $2, $3)", [email, name, await hash(password)]);
  await signIn("credentials", { email, password, redirectTo: "/" });
}

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: String(form.get("email") ?? "").trim().toLowerCase(),
      password: String(form.get("password") ?? ""),
      redirectTo: String(form.get("next") || "/"),
    });
  } catch (e) {
    if (e instanceof AuthError) return { error: "That email and password don't match." };
    throw e;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

const companySchema = z.object({
  name: z.string().trim().min(1, "Enter your business name.").max(200),
  entityType: z.enum(["sole_prop", "llc_single", "llc_multi", "partnership", "s_corp", "c_corp", "nonprofit"]),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  accountingMethod: z.enum(["accrual", "cash"]),
  timezone: z.string().min(1).max(64),
});

export async function createCompanyAction(_: FormState, form: FormData): Promise<FormState> {
  const userId = await requireUser();
  const parsed = companySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const c = parsed.data;
  const companyId = await tx(async (db) => {
    const company = await one<{ id: string }>(
      `insert into companies (name, entity_type, fiscal_year_start_month, accounting_method, timezone)
       values ($1, $2, $3, $4, $5) returning id`,
      [c.name, c.entityType, c.fiscalYearStartMonth, c.accountingMethod, c.timezone],
      db,
    );
    const id = company!.id;
    await query(`insert into memberships (company_id, user_id, role) values ($1, $2, 'owner')`, [id, userId], db);
    for (const a of seedAccounts(c.entityType as EntityType)) {
      await query(
        `insert into accounts (company_id, name, type, detail_type, system_role) values ($1, $2, $3, $4, $5)`,
        [id, a.name, a.type, a.detail, a.role ?? null],
        db,
      );
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
      [id, userId, JSON.stringify(c)],
      db,
    );
    return id;
  });
  redirect(`/c/${companyId}`);
}
