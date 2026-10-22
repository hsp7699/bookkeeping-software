"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerDrawer } from "@/components/contact-drawer";

export function NewCustomerButton({ companyId, terms }: { companyId: string; terms: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New customer
      </Button>
      <CustomerDrawer companyId={companyId} open={open} onOpenChange={setOpen} terms={terms} onSaved={() => router.refresh()} />
    </>
  );
}
