"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CustomerDrawer, type CustomerDraft } from "@/components/contact-drawer";
import { Button } from "@/components/ui/button";

export function NewVendorButton({ companyId, terms }: { companyId: string; terms: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New vendor
      </Button>
      <CustomerDrawer kind="vendor" companyId={companyId} open={open} onOpenChange={setOpen} terms={terms} onSaved={() => router.refresh()} />
    </>
  );
}

export function EditVendorButton({ companyId, vendor, terms }: { companyId: string; vendor: CustomerDraft; terms: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit</Button>
      <CustomerDrawer kind="vendor" companyId={companyId} open={open} onOpenChange={setOpen} initial={vendor} terms={terms} onSaved={() => router.refresh()} />
    </>
  );
}
