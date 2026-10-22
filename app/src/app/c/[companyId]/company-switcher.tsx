"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Plus } from "lucide-react";
import Link from "next/link";

/** The company name in the header; opens a list of the user's other companies. */
export function CompanySwitcher({ current, companies }: { current: string; companies: { id: string; name: string }[] }) {
  const name = companies.find((c) => c.id === current)?.name ?? "";
  return (
    <Menu.Root>
      <Menu.Trigger className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 font-semibold hover:bg-row-hover" aria-label={`Company: ${name}. Switch company`}>
        <span className="truncate">{name}</span>
        <ChevronDown className="size-4 shrink-0 text-text-muted" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" className="z-50 min-w-60 rounded-md border border-border bg-bg py-1 shadow-pop">
          <Menu.Label className="px-3 py-1 text-xs text-text-muted uppercase">Your companies</Menu.Label>
          {companies.map((c) => (
            <Menu.Item key={c.id} asChild className="outline-none data-[highlighted]:bg-row-hover">
              <Link href={`/c/${c.id}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                {c.name}
                {c.id === current && <Check className="size-4 text-accent" aria-label="Current" />}
              </Link>
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item asChild className="outline-none data-[highlighted]:bg-row-hover">
            <Link href="/setup" className="flex items-center gap-2 px-3 py-1.5">
              <Plus className="size-4" aria-hidden /> Add a company
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
