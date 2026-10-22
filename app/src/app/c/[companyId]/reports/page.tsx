import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";

const groups: { title: string; reports: { slug: string; name: string; blurb: string; ready?: boolean }[] }[] = [
  {
    title: "Business overview",
    reports: [
      { slug: "profit-and-loss", name: "Profit and loss", blurb: "Income, expenses and net income for a period.", ready: true },
      { slug: "balance-sheet", name: "Balance sheet", blurb: "What you own and owe on a date.", ready: true },
    ],
  },
  {
    title: "Who owes you",
    reports: [
      { slug: "ar-aging", name: "A/R aging summary", blurb: "Unpaid invoices by how overdue they are.", ready: true },
      { slug: "ar-aging?view=detail", name: "A/R aging detail", blurb: "Every open invoice and credit, oldest first.", ready: true },
    ],
  },
  {
    title: "What you owe",
    reports: [
      { slug: "ap-aging", name: "A/P aging summary", blurb: "Unpaid bills by how overdue they are.", ready: true },
      { slug: "ap-aging?view=detail", name: "A/P aging detail", blurb: "Every open bill and vendor credit.", ready: true },
    ],
  },
  {
    title: "For your accountant",
    reports: [
      { slug: "general-ledger", name: "General ledger", blurb: "Every ledger entry by account, with running balances.", ready: true },
      { slug: "profit-and-loss?columns=months", name: "Profit and loss by month", blurb: "Income and expenses month by month.", ready: true },
    ],
  },
];

export default async function ReportsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireCompany(companyId);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Reports</h1>
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-3">
          <h2 className="text-md font-semibold">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.reports.map((r) =>
              r.ready ? (
                <Link key={r.slug} href={`/c/${companyId}/reports/${r.slug}`} className="group">
                  <Card className="flex h-full gap-3 p-4 group-hover:border-accent">
                    <BarChart3 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-sm text-text-muted">{r.blurb}</p>
                    </div>
                  </Card>
                </Link>
              ) : (
                <Card key={r.slug} className="flex h-full gap-3 p-4 opacity-60" aria-disabled>
                  <BarChart3 className="mt-0.5 size-5 shrink-0 text-text-muted" aria-hidden />
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-sm text-text-muted">{r.blurb} Coming soon.</p>
                  </div>
                </Card>
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
