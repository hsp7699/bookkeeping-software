import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { ACCOUNT_TYPE_LABELS } from "@/lib/coa";
import { formatCents } from "@/lib/money";
import { listAccountsWithBalances } from "@/lib/queries";

function detailLabel(d: string) {
  const s = d.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function AccountsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const rows = await listAccountsWithBalances(companyId);
  const pnl = new Set(["income", "cost_of_goods_sold", "expense", "other_income", "other_expense"]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Chart of accounts</h1>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Detail type</Th>
              <Th numeric>Balance</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium">
                  {a.name}
                  {a.system_role && <span className="ml-2 text-xs font-normal text-text-muted">(system)</span>}
                </Td>
                <Td>{ACCOUNT_TYPE_LABELS[a.type]}</Td>
                <Td className="text-text-muted">{detailLabel(a.detail_type)}</Td>
                <Td numeric>{pnl.has(a.type) ? "" : formatCents(a.balance_cents)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
