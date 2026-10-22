import Link from "next/link";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { TXN_LABEL, txnHref } from "@/lib/routes";

const ACTION: Record<string, string> = {
  create: "Added",
  update: "Edited",
  delete: "Deleted",
  void: "Voided",
  reconcile: "Reconciled",
  unreconcile: "Undid reconciliation",
  close_override: "Changed closed period",
  login: "Signed in",
};

type Snap = { type?: string; number?: string | null; total_cents?: number; name?: string; displayName?: string; display_name?: string } | null;

export default async function AuditPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ before?: string }> }) {
  const { companyId } = await params;
  const { before } = await searchParams;
  await requireCompany(companyId, "accountant");
  const rows = await query<{ id: number; at: Date; user_name: string | null; entity: string; entity_id: string; action: string; before: Snap; after: Snap; exists: boolean }>(
    `select a.id, a.at, u.name as user_name, a.entity, a.entity_id, a.action, a.before, a.after,
            exists(select 1 from transactions t where t.id = a.entity_id) as exists
     from audit_events a left join users u on u.id = a.user_id
     where a.company_id = $1 and ($2::bigint is null or a.id < $2)
     order by a.id desc limit 100`,
    [companyId, before ?? null],
  );
  const tz = (await query<{ timezone: string }>("select timezone from companies where id = $1", [companyId]))[0].timezone;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Audit log</h1>
      <p className="text-text-muted">Every change to your books, who made it and when. Entries can't be edited or removed.</p>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>User</Th>
              <Th>Event</Th>
              <Th>Record</Th>
              <Th numeric>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const snap = r.after ?? r.before;
              const label =
                r.entity === "transaction"
                  ? `${TXN_LABEL[snap?.type ?? ""] ?? "Transaction"}${snap?.number ? ` ${snap.number}` : ""}`
                  : `${r.entity.charAt(0).toUpperCase()}${r.entity.slice(1)}${snap?.name || snap?.displayName || snap?.display_name ? `: ${snap?.name ?? snap?.displayName ?? snap?.display_name}` : ""}`;
              return (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{fmt.format(r.at)}</Td>
                  <Td>{r.user_name ?? "System"}</Td>
                  <Td>{ACTION[r.action] ?? r.action}</Td>
                  <Td>
                    {r.entity === "transaction" && r.exists && snap?.type ? (
                      <Link className="text-accent hover:underline" href={txnHref(companyId, snap.type, r.entity_id)}>
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </Td>
                  <Td numeric>{snap?.total_cents != null ? formatCents(snap.total_cents) : ""}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {rows.length === 100 && (
        <Link href={`?before=${rows[rows.length - 1].id}`} className="self-end text-accent hover:underline">
          Older →
        </Link>
      )}
    </div>
  );
}
