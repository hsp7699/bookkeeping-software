"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerDrawer, type CustomerDraft } from "@/components/contact-drawer";

export function EditCustomerButton({
  companyId,
  customer,
  terms,
  taxRates,
}: {
  companyId: string;
  customer: CustomerDraft;
  terms: { id: string; name: string }[];
  taxRates: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit</Button>
      <CustomerDrawer companyId={companyId} open={open} onOpenChange={setOpen} initial={customer} terms={terms} taxRates={taxRates} onSaved={() => router.refresh()} />
    </>
  );
}
