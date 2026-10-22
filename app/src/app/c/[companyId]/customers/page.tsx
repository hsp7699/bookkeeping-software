import { Users } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { customerMoneyBar, listCustomers, listTerms } from "@/lib/queries";
import { NewCustomerButton } from "./new-customer-button";

type Filter = "all" | "open" | "overdue";

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { companyId } = await params;
  const { filter: f } = await searchParams;
  await requireCompany(companyId);
  const filter: Filter = f === "open" || f === "overdue" ? f : "all";
  const [rows, bar, terms] = await Promise.all([listCustomers(companyId, filter), customerMoneyBar(companyId), listTerms(companyId)]);
  const base = `/c/${companyId}/customers`;

  const segments = [
    { key: "overdue", label: "Overdue", count: bar!.overdue_count, cents: bar!.overdue_cents, bar: "bg-warning" },
    { key: "open", label: "Open invoices", count: bar!.open_count, cents: bar!.open_cents, bar: "bg-accent" },
    { key: "paid", label: "Paid last 30 days", count: bar!.paid_count, cents: bar!.paid_cents, bar: "bg-success", href: `/c/${companyId}/invoices?status=paid` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Customers</h1>
        <NewCustomerButton companyId={companyId} terms={terms} />
      </div>

      <Card className="grid grid-cols-1 gap-px overflow-hidden bg-border sm:grid-cols-3" aria-label="Money bar">
        {segments.map((s) => {
          const pressed = filter === s.key;
          return (
            <Link
              key={s.key}
              href={s.href ?? (pressed ? base : `${base}?filter=${s.key}`)}
              aria-pressed={s.href ? undefined : pressed}
              className={cn("flex flex-col gap-1 bg-bg p-4 hover:bg-row-hover", pressed && "bg-row-selected")}
            >
              <span className="num text-left text-lg font-semibold">{formatCents(s.cents)}</span>
              <span className="text-sm text-text-muted">
                {s.count} {s.label.toLowerCase()}
              </span>
              <span className={cn("mt-1 h-1.5 rounded-pill", s.bar)} aria-hidden />
            </Link>
          );
        })}
      </Card>

      <Card>
        {rows.length === 0 ? (
          filter === "all" ? (
            <EmptyState icon={Users} title="No customers yet" body="Add the people and businesses you invoice." />
          ) : (
            <p className="p-8 text-center text-text-muted">
              No customers match this filter.{" "}
              <Link href={base} className="text-accent hover:underline">
                Show all
              </Link>
            </p>
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                <Th numeric>Open balance</Th>
                <Th numeric>Overdue</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`${base}/${c.id}`} className="font-medium text-accent hover:underline">
                      {c.display_name}
                    </Link>
                    {c.company_name && c.company_name !== c.display_name && <div className="text-sm text-text-muted">{c.company_name}</div>}
                  </Td>
                  <Td>{c.email}</Td>
                  <Td>{c.phone}</Td>
                  <Td numeric>{formatCents(c.open_cents)}</Td>
                  <Td numeric className={c.overdue_cents > 0 ? "text-danger" : "text-text-muted"}>
                    {formatCents(c.overdue_cents)}
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
