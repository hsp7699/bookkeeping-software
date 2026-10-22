"use server";

import { hash } from "@node-rs/argon2";
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { one, query, tx } from "@/db";
import type { EntityType } from "@/lib/coa";
import { createCompany } from "@/lib/company";
import { requireUser } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";

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
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`signup:ip:${ip}`, 5, 60 * 60 * 1000).ok) return { error: "Too many new accounts from this network. Try again later." };
  if (process.env.ALLOW_SIGNUP === "false") return { error: "New sign-ups are turned off on this server." };
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { name, email, password } = parsed.data;
  const exists = await one("select 1 from users where email = $1", [email]);
  if (exists) return { fieldErrors: { email: "An account with this email already exists. Sign in instead." } };
  await query("insert into users (email, name, password_hash) values ($1, $2, $3)", [email, name, await hash(password)]);
  await signIn("credentials", { email, password, redirectTo: "/" });
}

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // 10 tries per 15 minutes per address and per IP
  for (const key of [`signin:email:${email}`, `signin:ip:${ip}`]) {
    const r = rateLimit(key, 10, 15 * 60 * 1000);
    if (!r.ok) return { error: `Too many sign-in attempts. Try again in ${Math.ceil(r.retryAfterSec / 60)} minutes.` };
  }
  try {
    await signIn("credentials", {
      email,
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
  const companyId = await tx((db) => createCompany(db, userId, { ...c, entityType: c.entityType as EntityType }));
  redirect(`/c/${companyId}`);
}
