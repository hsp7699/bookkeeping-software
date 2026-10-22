"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const columns: { label: string; items: { label: string; href?: string }[] }[] = [
  {
    label: "Customers",
    items: [{ label: "Invoice", href: "/invoices/new" }, { label: "Receive payment", href: "/payments/new" }, { label: "Sales receipt" }, { label: "Credit memo" }],
  },
  { label: "Vendors", items: [{ label: "Expense" }, { label: "Check" }, { label: "Bill" }, { label: "Pay bills" }] },
  { label: "Other", items: [{ label: "Bank deposit" }, { label: "Transfer" }, { label: "Journal entry" }] },
];

/** Quick Create (+ New). "n" opens it from anywhere outside a text field. */
export function NewMenu({ companyId }: { companyId: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !t.closest("input,textarea,select,[contenteditable]")) {
        document.getElementById("new-menu-trigger")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button id="new-menu-trigger" variant="primary" size="md">
          <Plus className="size-4" aria-hidden /> New
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 grid grid-cols-3 gap-6 rounded-lg border border-border bg-bg p-5 shadow-pop">
          {columns.map((col) => (
            <Menu.Group key={col.label} className="flex min-w-36 flex-col">
              <Menu.Label className="pb-2 text-xs font-medium tracking-wide text-text-muted uppercase">{col.label}</Menu.Label>
              {col.items.map((item) => (
                <Menu.Item
                  key={item.label}
                  disabled={!item.href}
                  onSelect={() => item.href && router.push(`/c/${companyId}${item.href}`)}
                  className="cursor-pointer rounded-sm px-2 py-1.5 outline-none data-[disabled]:cursor-default data-[disabled]:text-text-subtle data-[highlighted]:bg-row-hover"
                >
                  {item.label}
                </Menu.Item>
              ))}
            </Menu.Group>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
