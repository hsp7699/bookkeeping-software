import { Store } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { listTerms, listVendors, vendorMoneyBar } from "@/lib/queries";
import { NewVendorButton } from "./vendor-buttons";

export default async function VendorsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { companyId } = await params;
  const { filter: f } = await searchParams;
  await requireCompany(companyId);
  const filter = f === "open" || f === "overdue" ? f : "all";
  const [rows, bar, terms] = await Promise.all([listVendors(companyId, filter), vendorMoneyBar(companyId), listTerms(companyId)]);
  const base = `/c/${companyId}/vendors`;
  const segments = [
    { key: "overdue", label: "Overdue bills", count: bar!.overdue_count, cents: bar!.overdue_cents, bar: "bg-warning" },
    { key: "open", label: "Open bills", count: bar!.open_count, cents: bar!.open_cents, bar: "bg-accent" },
    { key: "paid", label: "Paid last 30 days", count: bar!.paid_count, cents: bar!.paid_cents, bar: "bg-success", href: `/c/${companyId}/expenses` },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Vendors</h1>
        <NewVendorButton companyId={companyId} terms={terms} />
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
            <EmptyState icon={Store} title="No vendors yet" body="Add the businesses and people you buy from, so bills and expenses have a name on them." />
          ) : (
            <p className="p-8 text-center text-text-muted">No vendors match this filter.</p>
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                <Th numeric>Open balance</Th>
                <Th numeric>Overdue</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <Link href={`${base}/${v.id}`} className="font-medium text-accent hover:underline">
                      {v.display_name}
                    </Link>
                  </Td>
                  <Td>{v.email}</Td>
                  <Td>{v.phone}</Td>
                  <Td numeric>{formatCents(v.open_cents)}</Td>
                  <Td numeric className={v.overdue_cents > 0 ? "text-danger" : "text-text-muted"}>
                    {formatCents(v.overdue_cents)}
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
