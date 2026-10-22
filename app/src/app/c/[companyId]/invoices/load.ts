import "server-only";
import { companyToday, listAccountsByType, listCustomerOptions, listItems, listTaxRates, listTerms } from "@/lib/queries";

export async function loadInvoiceFormData(companyId: string) {
  const [today, customers, items, terms, taxRates, incomeAccounts] = await Promise.all([
    companyToday(companyId),
    listCustomerOptions(companyId),
    listItems(companyId),
    listTerms(companyId),
    listTaxRates(companyId),
    listAccountsByType(companyId, ["income", "other_income"]),
  ]);
  return {
    today,
    customers,
    items: items.map((i) => ({ id: i.id, name: i.name, description: i.description, sales_price_cents: i.sales_price_cents, taxable: i.taxable })),
    terms,
    taxRates,
    incomeAccounts: incomeAccounts.map((a) => ({ id: a.id, name: a.name })),
  };
}
