"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerDrawer } from "@/components/contact-drawer";

export function NewCustomerButton({
  companyId,
  terms,
  taxRates,
  parents,
}: {
  companyId: string;
  terms: { id: string; name: string }[];
  taxRates: { id: string; name: string }[];
  parents: { id: string; display_name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New customer
      </Button>
      <CustomerDrawer companyId={companyId} open={open} onOpenChange={setOpen} terms={terms} taxRates={taxRates} parents={parents} onSaved={() => router.refresh()} />
    </>
  );
}
