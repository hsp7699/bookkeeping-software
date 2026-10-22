import Link from "next/link";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { ACCOUNT_TYPE_LABELS, BALANCE_SHEET_TYPES, humanize } from "@/lib/coa";
import { formatCents } from "@/lib/money";
import { asTree, companyToday, listAccountsWithBalances } from "@/lib/queries";
import { AccountRowActions, NewAccountButton } from "./accounts-client";

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ inactive?: string }>;
}) {
  const { companyId } = await params;
  const { inactive } = await searchParams;
  await requireCompany(companyId);
  const showInactive = inactive === "1";
  const [rows, today] = await Promise.all([listAccountsWithBalances(companyId, showInactive), companyToday(companyId)]);
  const tree = asTree(rows);
  const parents = rows.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, type: r.type }));
  const base = `/c/${companyId}/accounts`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Chart of accounts</h1>
        <NewAccountButton companyId={companyId} parents={parents} today={today} />
      </div>
      <Link href={showInactive ? base : `${base}?inactive=1`} className="self-start text-sm text-accent hover:underline">
        {showInactive ? "Hide inactive accounts" : "Show inactive accounts"}
      </Link>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Detail type</Th>
              <Th numeric>Balance</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {tree.map((a) => (
              <Tr key={a.id} className={cn(!a.active && "text-text-muted")}>
                <Td className="text-text-muted">{a.number}</Td>
                <Td className="font-medium" style={{ paddingLeft: 12 + a.depth * 20 }}>
                  {a.name}
                  {a.system_role && <span className="ml-2 text-xs font-normal text-text-muted">(system)</span>}
                  {!a.active && <span className="ml-2 text-xs font-normal">(inactive)</span>}
                </Td>
                <Td>{ACCOUNT_TYPE_LABELS[a.type]}</Td>
                <Td className="text-text-muted">{humanize(a.detail_type)}</Td>
                <Td numeric>{BALANCE_SHEET_TYPES.has(a.type) ? formatCents(a.balance_cents) : ""}</Td>
                <Td>
                  <AccountRowActions
                    companyId={companyId}
                    active={a.active}
                    parents={parents}
                    today={today}
                    account={{
                      id: a.id,
                      name: a.name,
                      number: a.number,
                      type: a.type,
                      detailType: a.detail_type,
                      parentId: a.parent_id,
                      description: a.description,
                      system: !!a.system_role,
                    }}
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
