"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { AccountType } from "@/lib/coa";
import { AccountDrawer, type AccountDraft } from "./account-drawer";
import { setAccountActiveAction } from "./actions";

type Parent = { id: string; name: string; type: AccountType };

export function NewAccountButton({ companyId, parents, today }: { companyId: string; parents: Parent[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New account
      </Button>
      <AccountDrawer companyId={companyId} open={open} onOpenChange={setOpen} parents={parents} today={today} />
    </>
  );
}

export function AccountRowActions({
  companyId,
  account,
  parents,
  today,
  active,
}: {
  companyId: string;
  account: AccountDraft & { id: string };
  parents: Parent[];
  today: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex items-center justify-end gap-1">
      {error && (
        <span role="alert" className="mr-2 max-w-xs text-sm text-danger">
          {error}
        </span>
      )}
      <Button asChild variant="link">
        <Link href={`/c/${companyId}/accounts/${account.id}`}>View register</Link>
      </Button>
      <Menu.Root>
        <Menu.Trigger className="rounded-sm p-1.5 text-text-muted hover:bg-row-hover" aria-label={`More actions for ${account.name}`} disabled={pending}>
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" className="z-50 min-w-40 rounded-md border border-border bg-bg py-1 shadow-pop">
            <Menu.Item className="cursor-pointer px-3 py-1.5 outline-none data-[highlighted]:bg-row-hover" onSelect={() => setOpen(true)}>
              Edit
            </Menu.Item>
            <Menu.Item
              className="cursor-pointer px-3 py-1.5 outline-none data-[highlighted]:bg-row-hover"
              onSelect={() =>
                start(async () => {
                  const res = await setAccountActiveAction(companyId, account.id, !active);
                  if (!res.ok) setError(res.error);
                  else {
                    setError(null);
                    router.refresh();
                  }
                })
              }
            >
              {active ? "Make inactive" : "Make active"}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <AccountDrawer companyId={companyId} open={open} onOpenChange={setOpen} initial={account} parents={parents} today={today} />
    </div>
  );
}
