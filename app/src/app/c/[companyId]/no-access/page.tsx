import { Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/table";
import { requireCompany } from "@/lib/authz";
import { roleInfo } from "@/lib/roles";

export default async function NoAccess({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId);
  return (
    <Card>
      <EmptyState icon={Lock} title="You don't have access to that" body={`Your role in ${ctx.companyName} is ${roleInfo(ctx.role).label.toLowerCase()}. ${roleInfo(ctx.role).blurb} Ask an owner or admin if you need more.`} />
      <div className="flex justify-center pb-8">
        <Button asChild variant="primary">
          <Link href={`/c/${companyId}`}>Go to Home</Link>
        </Button>
      </div>
    </Card>
  );
}
