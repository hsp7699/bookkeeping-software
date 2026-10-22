"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany, type Role } from "@/lib/authz";
import { appUrl, INVITE_DAYS, newInviteToken } from "@/lib/invites";
import { roleInfo } from "@/lib/roles";
import { mailConfigured, sendMail } from "@/lib/mail";
import type { ActionResult } from "../actions";

const ROLES = ["owner", "admin", "accountant", "standard", "reports_only"] as const;

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(ROLES),
});

function audit(companyId: string, userId: string, id: string, action: string, after?: unknown) {
  return query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, 'membership', $3, $4, $5)", [
    companyId,
    userId,
    id,
    action,
    after === undefined ? null : JSON.stringify(after),
  ]);
}

/** Email the link if mail is set up. Either way the inviter gets the link to share. */
async function deliver(companyId: string, inviterId: string, email: string, role: string, token: string) {
  const link = `${await appUrl()}/invite/${token}`;
  let emailed = false;
  if (mailConfigured()) {
    const info = await one<{ company: string; inviter: string | null }>(
      "select c.name as company, u.name as inviter from companies c, users u where c.id = $1 and u.id = $2",
      [companyId, inviterId],
    );
    try {
      await sendMail({
        to: [email],
        subject: `${info?.inviter ?? "Someone"} invited you to ${info?.company} on Books`,
        text: `Hello,\n\n${info?.inviter ?? "Someone"} invited you to work on the books for ${info?.company} as ${roleInfo(role).label.toLowerCase()}.\n\nAccept the invitation here (the link works for ${INVITE_DAYS} days):\n${link}\n`,
      });
      emailed = true;
    } catch (e) {
      console.error("invite email failed", e);
    }
  }
  return { link, emailed };
}

export async function inviteUserAction(companyId: string, raw: unknown): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const ctx = await requireCompany(companyId, "admin");
  const p = inviteSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { email, role } = p.data;
  if (role === "owner" && ctx.role !== "owner") return { ok: false, error: "Only an owner can invite another owner." };
  const existing = await one<{ id: string; status: string }>(
    `select m.id, m.status from memberships m left join users u on u.id = m.user_id
     where m.company_id = $1 and (u.email = $2 or m.invited_email = $2) and m.status <> 'removed'`,
    [companyId, email],
  );
  if (existing?.status === "active") return { ok: false, error: "That person already has access." };
  const { token, hash } = newInviteToken();
  let id: string;
  if (existing) {
    await query(
      "update memberships set role = $2, invite_token_hash = $3, invite_expires_at = now() + make_interval(days => $4), invited_by = $5 where id = $1",
      [existing.id, role, hash, INVITE_DAYS, ctx.userId],
    );
    id = existing.id;
  } else {
    id = (await one<{ id: string }>(
      `insert into memberships (company_id, invited_email, role, status, invite_token_hash, invite_expires_at, invited_by)
       values ($1, $2, $3, 'invited', $4, now() + make_interval(days => $5), $6) returning id`,
      [companyId, email, role, hash, INVITE_DAYS, ctx.userId],
    ))!.id;
  }
  await audit(companyId, ctx.userId, id, "create", { invited: email, role });
  revalidatePath(`/c/${companyId}/users`);
  return { ok: true, data: await deliver(companyId, ctx.userId, email, role, token) };
}

/** A fresh link (the old one stops working). */
export async function resendInviteAction(companyId: string, membershipId: string): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const ctx = await requireCompany(companyId, "admin");
  const m = await one<{ invited_email: string; role: string }>("select invited_email, role from memberships where company_id = $1 and id = $2 and status = 'invited'", [companyId, membershipId]);
  if (!m) return { ok: false, error: "That invitation was already accepted or cancelled." };
  const { token, hash } = newInviteToken();
  await query("update memberships set invite_token_hash = $2, invite_expires_at = now() + make_interval(days => $3) where id = $1", [membershipId, hash, INVITE_DAYS]);
  revalidatePath(`/c/${companyId}/users`);
  return { ok: true, data: await deliver(companyId, ctx.userId, m.invited_email, m.role, token) };
}

async function ownerCount(companyId: string) {
  return (await one<{ n: number }>("select count(*)::int as n from memberships where company_id = $1 and role = 'owner' and status = 'active'", [companyId]))!.n;
}

export async function changeRoleAction(companyId: string, membershipId: string, role: Role): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "admin");
  if (!(ROLES as readonly string[]).includes(role)) return { ok: false, error: "Pick a role." };
  const m = await one<{ role: Role; status: string; user_id: string | null }>("select role, status, user_id from memberships where company_id = $1 and id = $2", [companyId, membershipId]);
  if (!m || m.status === "removed") return { ok: false, error: "That user no longer has access." };
  if ((m.role === "owner" || role === "owner") && ctx.role !== "owner") return { ok: false, error: "Only an owner can add or change owners." };
  if (m.role === "owner" && role !== "owner" && m.status === "active" && (await ownerCount(companyId)) <= 1) return { ok: false, error: "A company needs at least one owner. Make someone else an owner first." };
  await query("update memberships set role = $3 where company_id = $1 and id = $2", [companyId, membershipId, role]);
  await audit(companyId, ctx.userId, membershipId, "update", { role });
  revalidatePath(`/c/${companyId}/users`);
  return { ok: true, data: null };
}

/** Remove a user's access, or cancel a pending invitation. */
export async function removeMemberAction(companyId: string, membershipId: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "admin");
  const m = await one<{ role: Role; status: string; user_id: string | null }>("select role, status, user_id from memberships where company_id = $1 and id = $2", [companyId, membershipId]);
  if (!m || m.status === "removed") return { ok: true, data: null };
  if (m.user_id === ctx.userId) return { ok: false, error: "You can't remove yourself. Ask another admin or owner." };
  if (m.role === "owner" && ctx.role !== "owner") return { ok: false, error: "Only an owner can remove an owner." };
  if (m.role === "owner" && m.status === "active" && (await ownerCount(companyId)) <= 1) return { ok: false, error: "A company needs at least one owner." };
  if (m.status === "invited") await query("delete from memberships where id = $1", [membershipId]);
  else await query("update memberships set status = 'removed', invite_token_hash = null where id = $1", [membershipId]);
  await audit(companyId, ctx.userId, membershipId, "delete", { status: m.status });
  revalidatePath(`/c/${companyId}/users`);
  return { ok: true, data: null };
}
