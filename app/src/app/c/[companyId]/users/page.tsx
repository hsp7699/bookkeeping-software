import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { mailConfigured } from "@/lib/mail";
import { UsersClient, type MemberRow } from "./users-client";

export default async function UsersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "admin");
  const rows = await query<MemberRow>(
    `select m.id, m.role, m.status, coalesce(u.email, m.invited_email)::text as email, u.name, m.user_id = $2 as is_me,
            m.invite_expires_at < now() as expired, m.created_at
     from memberships m left join users u on u.id = m.user_id
     where m.company_id = $1 and m.status <> 'removed'
     order by m.status, array_position(array['owner','admin','accountant','standard','reports_only'], m.role), lower(coalesce(u.name, m.invited_email))`,
    [companyId, ctx.userId],
  );
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Users</h1>
        <p className="mt-1 text-text-muted">Invite your team or your accountant. Each person signs in with their own email and password.</p>
      </div>
      <UsersClient companyId={companyId} rows={rows} myRole={ctx.role} mailReady={mailConfigured()} />
    </div>
  );
}
