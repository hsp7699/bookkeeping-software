import "server-only";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { one } from "@/db";

export type Role = "owner" | "admin" | "standard" | "accountant" | "reports_only";

const rank: Record<Role, number> = { reports_only: 0, standard: 1, accountant: 2, admin: 3, owner: 4 };

export interface CompanyContext {
  userId: string;
  companyId: string;
  companyName: string;
  role: Role;
}

export async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

/**
 * Every company-scoped page and action starts here: the user must be an
 * active member with at least `min` role. Unknown or foreign companies 404.
 */
export async function requireCompany(companyId: string, min: Role = "reports_only"): Promise<CompanyContext> {
  const userId = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) notFound();
  const m = await one<{ role: Role; name: string }>(
    `select m.role, c.name from memberships m join companies c on c.id = m.company_id
     where m.company_id = $1 and m.user_id = $2 and m.status = 'active'`,
    [companyId, userId],
  );
  if (!m) notFound();
  if (rank[m.role] < rank[min]) redirect(`/c/${companyId}/no-access`);
  return { userId, companyId, companyName: m.name, role: m.role };
}

export function canWrite(role: Role) {
  return rank[role] >= rank.standard;
}
