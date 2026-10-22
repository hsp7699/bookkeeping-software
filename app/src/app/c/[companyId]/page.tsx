import { FileText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";

// Placeholder home. The real dashboard (S03) arrives with the reports milestone.
export default async function Home({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Home</h1>
      <Card>
        <EmptyState
          icon={FileText}
          title={`Welcome to ${ctx.companyName}`}
          body="Start by sending an invoice. Everything you record lands in your books and reports right away."
          action={
            <Button asChild variant="primary">
              <Link href={`/c/${companyId}/invoices/new`}>Create an invoice</Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
