// Where each transaction type is edited. One place, so registers, reports and
// search can all link to the right form.

export const TXN_LABEL: Record<string, string> = {
  invoice: "Invoice",
  sales_receipt: "Sales receipt",
  payment: "Payment",
  credit_memo: "Credit memo",
  refund_receipt: "Refund",
  expense: "Expense",
  check: "Check",
  bill: "Bill",
  bill_payment: "Bill payment",
  vendor_credit: "Vendor credit",
  credit_card_credit: "Credit card credit",
  deposit: "Deposit",
  transfer: "Transfer",
  journal_entry: "Journal entry",
  opening_balance: "Opening balance",
  sales_tax_payment: "Sales tax payment",
  estimate: "Estimate",
  purchase_order: "Purchase order",
};

const PATH: Record<string, string> = {
  invoice: "invoices",
  sales_receipt: "sales-receipts",
  payment: "payments",
  credit_memo: "credit-memos",
  refund_receipt: "refunds",
  expense: "expenses",
  check: "checks",
  bill: "bills",
  bill_payment: "bill-payments",
  vendor_credit: "vendor-credits",
  credit_card_credit: "card-credits",
  deposit: "deposits",
  transfer: "transfers",
  journal_entry: "journal-entries",
  opening_balance: "journal-entries",
  sales_tax_payment: "taxes",
  estimate: "estimates",
  purchase_order: "purchase-orders",
};

export function txnHref(companyId: string, type: string, id: string): string {
  if (type === "sales_tax_payment") return `/c/${companyId}/taxes`;
  return `/c/${companyId}/${PATH[type] ?? "invoices"}/${id}`;
}

export function newTxnHref(companyId: string, type: string): string {
  return `/c/${companyId}/${PATH[type]}/new`;
}
