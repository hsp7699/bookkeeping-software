import { Package } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { listAccountsByType, listItems } from "@/lib/queries";
import { ItemsClient } from "./items-client";

export default async function ItemsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  const [items, incomeAccounts] = await Promise.all([listItems(companyId), listAccountsByType(companyId, ["income", "other_income"])]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Products & services</h1>
        <ItemsClient companyId={companyId} incomeAccounts={incomeAccounts} mode="new" />
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={Package} title="Nothing to sell yet" body="Add the services you bill for and the products you sell, with their usual price." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>SKU</Th>
                <Th>Income account</Th>
                <Th>Taxable</Th>
                <Th numeric>Price</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-medium">
                    {i.name}
                    {i.description && <div className="max-w-md truncate text-sm font-normal text-text-muted">{i.description}</div>}
                  </Td>
                  <Td>{i.type === "service" ? "Service" : "Non-inventory"}</Td>
                  <Td>{i.sku}</Td>
                  <Td>{i.income_account_name}</Td>
                  <Td>{i.taxable ? "Yes" : "No"}</Td>
                  <Td numeric>{i.sales_price_cents != null ? formatCents(i.sales_price_cents) : ""}</Td>
                  <Td className="text-right">
                    <ItemsClient
                      companyId={companyId}
                      incomeAccounts={incomeAccounts}
                      mode="edit"
                      item={{
                        id: i.id,
                        name: i.name,
                        type: i.type,
                        sku: i.sku ?? undefined,
                        description: i.description ?? undefined,
                        salesPriceCents: i.sales_price_cents,
                        incomeAccountId: i.income_account_id ?? undefined,
                        taxable: i.taxable,
                      }}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
