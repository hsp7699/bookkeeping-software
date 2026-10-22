import type { Role } from "@/lib/authz";

// What each role can do, in the words shown on the Users page and invitations.
export const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: "owner", label: "Owner", blurb: "Everything, including adding and removing other owners." },
  { value: "admin", label: "Admin", blurb: "Everything except managing owners: settings, users, closing the books." },
  { value: "accountant", label: "Accountant", blurb: "For your outside bookkeeper: all transactions and reports. No company settings or users." },
  { value: "standard", label: "Standard", blurb: "Create and edit transactions, customers and vendors. No settings or users." },
  { value: "reports_only", label: "Reports only", blurb: "View reports and lists. Can't change anything." },
];

export const roleInfo = (r: string) => ROLES.find((x) => x.value === r) ?? { value: r as Role, label: r, blurb: "" };
