"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { one, query } from "@/db";
import { requireCompany } from "@/lib/authz";
import type { ActionResult } from "../actions";

const TABLE = { class: "classes", location: "locations", tag: "tags" } as const;
type Kind = keyof typeof TABLE;

const schema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1, "Enter a name.").max(100) });

export async function saveTrackingAction(companyId: string, kind: Kind, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireCompany(companyId, "admin");
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const t = TABLE[kind];
  try {
    const row = p.data.id
      ? await one<{ id: string }>(`update ${t} set name = $3 where company_id = $1 and id = $2 returning id`, [companyId, p.data.id, p.data.name])
      : await one<{ id: string }>(`insert into ${t} (company_id, name) values ($1, $2) returning id`, [companyId, p.data.name]);
    if (!row) return { ok: false, error: "That no longer exists." };
    await query("insert into audit_events (company_id, user_id, entity, entity_id, action, after) values ($1, $2, $3, $4, $5, $6)", [
      companyId,
      ctx.userId,
      kind,
      row.id,
      p.data.id ? "update" : "create",
      JSON.stringify({ name: p.data.name }),
    ]);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, data: row };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, error: `There's already a ${kind} with that name.` };
    throw e;
  }
}

/** Classes and locations are made inactive (they're on past transactions); unused tags are deleted. */
export async function removeTrackingAction(companyId: string, kind: Kind, id: string): Promise<ActionResult<null>> {
  const ctx = await requireCompany(companyId, "admin");
  if (kind === "tag") await query("delete from tags where company_id = $1 and id = $2", [companyId, id]);
  else await query(`update ${TABLE[kind]} set active = false where company_id = $1 and id = $2`, [companyId, id]);
  await query("insert into audit_events (company_id, user_id, entity, entity_id, action) values ($1, $2, $3, $4, 'delete')", [companyId, ctx.userId, kind, id]);
  revalidatePath(`/c/${companyId}`, "layout");
  return { ok: true, data: null };
}
