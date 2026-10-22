import "server-only";
import { companyToday, listAccountsByType, listCustomerOptions, listItems, listTaxRates, listTerms, listTracking } from "@/lib/queries";
import type { SalesKind } from "./sales-form";

export async function loadSalesFormData(companyId: string, kind: SalesKind) {
  const [today, customers, items, terms, taxRates, incomeAccounts, money, tracking] = await Promise.all([
    companyToday(companyId),
    listCustomerOptions(companyId),
    listItems(companyId),
    listTerms(companyId),
    listTaxRates(companyId),
    listAccountsByType(companyId, ["income", "other_income"]),
    listAccountsByType(companyId, ["bank", "other_current_asset", "credit_card"]),
    listTracking(companyId),
  ]);
  const moneyAccounts =
    kind === "sales_receipt"
      ? money
          .filter((a) => a.type === "bank" || a.system_role === "undeposited_funds")
          .sort((a, b) => Number(b.system_role === "undeposited_funds") - Number(a.system_role === "undeposited_funds"))
      : money.filter((a) => a.type === "bank" || a.type === "credit_card");
  return {
    today,
    customers,
    items: items.map((i) => ({ id: i.id, name: i.name, description: i.description, sales_price_cents: i.sales_price_cents, taxable: i.taxable })),
    terms,
    taxRates,
    incomeAccounts: incomeAccounts.map((a) => ({ id: a.id, name: a.name })),
    moneyAccounts,
    tracking,
  };
}
