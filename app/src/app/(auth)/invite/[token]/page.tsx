import Link from "next/link";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { one } from "@/db";
import { hashInviteToken } from "@/lib/invites";
import { roleInfo } from "@/lib/roles";
import { AuthCard } from "../../auth-card";
import { AcceptInvite } from "./accept";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = /^[A-Za-z0-9_-]{20,100}$/.test(token)
    ? await one<{ company: string; email: string; role: string; inviter: string | null; expired: boolean }>(
        `select c.name as company, m.invited_email as email, m.role, u.name as inviter, m.invite_expires_at < now() as expired
         from memberships m join companies c on c.id = m.company_id left join users u on u.id = m.invited_by
         where m.invite_token_hash = $1 and m.status = 'invited'`,
        [hashInviteToken(token)],
      )
    : null;
  if (!inv || inv.expired)
    return (
      <AuthCard title="This invitation can't be used">
        <p className="text-text-muted">
          {inv ? "It has expired." : "It was already accepted, cancelled, or replaced by a newer link."} Ask the person who invited you to send a new one.
        </p>
      </AuthCard>
    );
  const session = await auth();
  const me = session?.user?.email?.toLowerCase() ?? null;
  const here = `/invite/${token}`;
  return (
    <AuthCard title={`Join ${inv.company}`}>
      <div className="flex flex-col gap-4">
        <p>
          {inv.inviter ?? "Someone"} invited <strong>{inv.email}</strong> to {inv.company} as <strong>{roleInfo(inv.role).label.toLowerCase()}</strong>.
        </p>
        <p className="text-sm text-text-muted">{roleInfo(inv.role).blurb}</p>
        {!me ? (
          <div className="flex flex-col gap-2">
            <Button asChild variant="primary" size="lg">
              <Link href={`/signup?invite=${token}&email=${encodeURIComponent(inv.email)}`}>Create an account</Link>
            </Button>
            <Button asChild size="lg">
              <Link href={`/login?callbackUrl=${encodeURIComponent(here)}`}>I already have an account</Link>
            </Button>
          </div>
        ) : me !== inv.email.toLowerCase() ? (
          <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-on-warning-soft">
            You&apos;re signed in as {me}, but this invitation is for {inv.email}. Sign out and sign in with that address, or ask for an invitation to {me}.
          </p>
        ) : (
          <AcceptInvite token={token} />
        )}
      </div>
    </AuthCard>
  );
}
