"use client";

import { Copy, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Role } from "@/lib/authz";
import { roleInfo, ROLES } from "@/lib/roles";
import { changeRoleAction, inviteUserAction, removeMemberAction, resendInviteAction } from "./actions";

export interface MemberRow {
  id: string;
  role: Role;
  status: "active" | "invited";
  email: string;
  name: string | null;
  is_me: boolean;
  expired: boolean | null;
}

const label = (r: Role) => roleInfo(r).label;

function LinkBox({ link, emailed }: { link: string; emailed: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-md bg-success-soft p-3 text-on-success-soft">
      <p className="mb-2">{emailed ? "Invitation emailed. You can also share this link:" : "Share this link with them. It works once, for 14 days:"}</p>
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.target.select()} className="font-mono text-sm" />
        <Button
          onClick={async () => {
            await navigator.clipboard.writeText(link).catch(() => {});
            setCopied(true);
          }}
        >
          <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function UsersClient({ companyId, rows, myRole, mailReady }: { companyId: string; rows: MemberRow[]; myRole: Role; mailReady: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("standard");
  const [invited, setInvited] = useState<{ link: string; emailed: boolean } | null>(null);
  const [resent, setResent] = useState<{ id: string; link: string; emailed: boolean } | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const roles = myRole === "owner" ? ROLES : ROLES.filter((r) => r.value !== "owner");

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "That didn't work.");
      after?.();
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => {
            setInvited(null);
            setEmail("");
            setError(null);
            setOpen(true);
          }}
        >
          <UserPlus className="size-4" aria-hidden /> Invite a user
        </Button>
      </div>
      {error && !open && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
          {error}
        </p>
      )}
      {resent && <LinkBox link={resent.link} emailed={resent.emailed} />}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lockedOwner = r.role === "owner" && myRole !== "owner";
              return (
                <Tr key={r.id}>
                  <Td>
                    {r.name ?? <span className="text-text-muted">Not joined yet</span>}
                    {r.is_me && <span className="text-text-muted"> (you)</span>}
                  </Td>
                  <Td>{r.email}</Td>
                  <Td>
                    {r.is_me || lockedOwner ? (
                      label(r.role)
                    ) : (
                      <NativeSelect
                        aria-label={`Role for ${r.email}`}
                        value={r.role}
                        disabled={pending}
                        onChange={(e) => act(() => changeRoleAction(companyId, r.id, e.target.value as Role))}
                        className="h-8 max-w-40"
                      >
                        {roles.map((x) => (
                          <option key={x.value} value={x.value}>
                            {x.label}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Td>
                  <Td>
                    {r.status === "active" ? (
                      <StatusPill tone="paid">Active</StatusPill>
                    ) : r.expired ? (
                      <StatusPill tone="overdue">Invite expired</StatusPill>
                    ) : (
                      <StatusPill tone="open">Invited</StatusPill>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {r.status === "invited" && (
                      <Button size="sm" variant="ghost" onClick={() => act(async () => {
                        const res = await resendInviteAction(companyId, r.id);
                        if (res.ok) setResent({ id: r.id, ...res.data });
                        return res;
                      })}>
                        New link
                      </Button>
                    )}
                    {!r.is_me && !lockedOwner && (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(r)}>
                        {r.status === "invited" ? "Cancel invite" : "Remove"}
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Invite a user"
        description={mailReady ? "They get an email with a link to join." : "You'll get a link to send them yourself (email isn't set up on this server)."}
        footer={
          invited ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={() =>
                  act(async () => {
                    const res = await inviteUserAction(companyId, { email, role });
                    if (res.ok) setInvited(res.data);
                    return res;
                  })
                }
              >
                Send invitation
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
              {error}
            </p>
          )}
          {invited ? (
            <LinkBox link={invited.link} emailed={invited.emailed} />
          ) : (
            <>
              <Field label="Email" required>
                {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Role</legend>
                {roles.map((r) => (
                  <label key={r.value} className="flex items-start gap-2">
                    <input type="radio" name="role" className="mt-1" checked={role === r.value} onChange={() => setRole(r.value)} />
                    <span>
                      {r.label}
                      <span className="block text-sm text-text-muted">{r.blurb}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
        </div>
      </Drawer>
      <ConfirmDialog
        open={removing != null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.status === "invited" ? `Cancel the invitation for ${removing?.email}?` : `Remove ${removing?.name ?? removing?.email}?`}
        body={removing?.status === "invited" ? "The link stops working." : "They lose access to this company right away. Everything they entered stays."}
        confirmLabel={removing?.status === "invited" ? "Cancel invitation" : "Remove"}
        destructive
        pending={pending}
        onConfirm={() => act(() => removeMemberAction(companyId, removing!.id), () => setRemoving(null))}
      />
    </>
  );
}
