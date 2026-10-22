"use client";

import {
  BarChart3,
  BookOpen,
  FileText,
  History,
  Home,
  Landmark,
  Package,
  Receipt,
  Scale,
  Settings,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** not built yet: shown so the shape of the app is visible, but disabled */
  soon?: boolean;
}

const groups: { label?: string; items: Item[] }[] = [
  { items: [{ href: "", label: "Home", icon: Home }] },
  {
    label: "Sales",
    items: [
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/items", label: "Products & services", icon: Package },
    ],
  },
  {
    label: "Expenses",
    items: [
      { href: "/expenses", label: "Expenses", icon: Receipt, soon: true },
      { href: "/vendors", label: "Vendors", icon: Store, soon: true },
    ],
  },
  {
    label: "Banking",
    items: [
      { href: "/banking", label: "Bank transactions", icon: Landmark, soon: true },
      { href: "/reconcile", label: "Reconcile", icon: Scale, soon: true },
    ],
  },
  {
    label: "Accounting",
    items: [
      { href: "/accounts", label: "Chart of accounts", icon: BookOpen },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/audit", label: "Audit log", icon: History },
    ],
  },
  { items: [{ href: "/settings", label: "Settings", icon: Settings, soon: true }] },
];

export function Nav({ companyId }: { companyId: string }) {
  const path = usePathname();
  const base = `/c/${companyId}`;
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 px-3 py-4">
      {groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {g.label && <p className="px-3 pb-1 text-xs font-medium tracking-wide text-nav-text uppercase opacity-75">{g.label}</p>}
          {g.items.map((item) => {
            const href = base + item.href;
            const active = item.href === "" ? path === base : path.startsWith(href);
            const Icon = item.icon;
            const cls = cn(
              "flex h-9 items-center gap-3 rounded-md px-3 text-base",
              active ? "bg-nav-item-active font-semibold text-nav-text-active" : "text-nav-text hover:bg-nav-item-active/60",
              item.soon && "pointer-events-none opacity-50",
            );
            return item.soon ? (
              <span key={item.href} className={cls} aria-disabled title="Coming in a later milestone">
                <Icon className="size-4" aria-hidden />
                {item.label}
              </span>
            ) : (
              <Link key={item.href} href={href} className={cls} aria-current={active ? "page" : undefined}>
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
