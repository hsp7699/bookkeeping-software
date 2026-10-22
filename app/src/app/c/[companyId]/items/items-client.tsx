"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemDrawer, type ItemDraft } from "./item-drawer";

export function ItemsClient({
  companyId,
  incomeAccounts,
  mode,
  item,
}: {
  companyId: string;
  incomeAccounts: { id: string; name: string }[];
  mode: "new" | "edit";
  item?: ItemDraft;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      {mode === "new" ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> New product or service
        </Button>
      ) : (
        <Button variant="link" onClick={() => setOpen(true)} aria-label={`Edit ${item?.name}`}>
          Edit
        </Button>
      )}
      <ItemDrawer
        companyId={companyId}
        open={open}
        onOpenChange={setOpen}
        initial={item}
        incomeAccounts={incomeAccounts}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
