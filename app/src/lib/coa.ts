// The default US chart of accounts a new company starts with. Our own list,
// built from standard small-business accounting practice. Names can be edited
// after setup; `role` marks the system accounts the posting engine needs.

export type AccountType =
  | "bank"
  | "accounts_receivable"
  | "other_current_asset"
  | "fixed_asset"
  | "other_asset"
  | "accounts_payable"
  | "credit_card"
  | "other_current_liability"
  | "long_term_liability"
  | "equity"
  | "income"
  | "cost_of_goods_sold"
  | "expense"
  | "other_income"
  | "other_expense";

export type SystemRole =
  | "accounts_receivable"
  | "accounts_payable"
  | "undeposited_funds"
  | "opening_balance_equity"
  | "retained_earnings"
  | "sales_tax_payable"
  | "discounts_given"
  | "uncategorized_income"
  | "uncategorized_expense"
  | "uncategorized_asset";

export type EntityType = "sole_prop" | "llc_single" | "llc_multi" | "partnership" | "s_corp" | "c_corp" | "nonprofit";

export interface SeedAccount {
  name: string;
  type: AccountType;
  detail: string;
  role?: SystemRole;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  accounts_receivable: "Accounts receivable (A/R)",
  other_current_asset: "Other current assets",
  fixed_asset: "Fixed assets",
  other_asset: "Other assets",
  accounts_payable: "Accounts payable (A/P)",
  credit_card: "Credit card",
  other_current_liability: "Other current liabilities",
  long_term_liability: "Long-term liabilities",
  equity: "Equity",
  income: "Income",
  cost_of_goods_sold: "Cost of goods sold",
  expense: "Expenses",
  other_income: "Other income",
  other_expense: "Other expense",
};

/** Debit-normal types; the rest are credit-normal. */
export const DEBIT_NORMAL: ReadonlySet<AccountType> = new Set([
  "bank",
  "accounts_receivable",
  "other_current_asset",
  "fixed_asset",
  "other_asset",
  "cost_of_goods_sold",
  "expense",
  "other_expense",
]);

const common: SeedAccount[] = [
  { name: "Business Checking", type: "bank", detail: "checking" },
  { name: "Accounts Receivable", type: "accounts_receivable", detail: "accounts_receivable", role: "accounts_receivable" },
  { name: "Undeposited Funds", type: "other_current_asset", detail: "undeposited_funds", role: "undeposited_funds" },
  { name: "Uncategorized Asset", type: "other_current_asset", detail: "other_current_assets", role: "uncategorized_asset" },
  { name: "Prepaid Expenses", type: "other_current_asset", detail: "prepaid_expenses" },
  { name: "Equipment", type: "fixed_asset", detail: "machinery_and_equipment" },
  { name: "Accumulated Depreciation", type: "fixed_asset", detail: "accumulated_depreciation" },
  { name: "Accounts Payable", type: "accounts_payable", detail: "accounts_payable", role: "accounts_payable" },
  { name: "Business Credit Card", type: "credit_card", detail: "credit_card" },
  { name: "Sales Tax Payable", type: "other_current_liability", detail: "sales_tax_payable", role: "sales_tax_payable" },
  { name: "Loan Payable", type: "long_term_liability", detail: "notes_payable" },
  { name: "Opening Balance Equity", type: "equity", detail: "opening_balance_equity", role: "opening_balance_equity" },
  { name: "Retained Earnings", type: "equity", detail: "retained_earnings", role: "retained_earnings" },
  { name: "Sales", type: "income", detail: "sales_of_product_income" },
  { name: "Services", type: "income", detail: "service_fee_income" },
  { name: "Discounts Given", type: "income", detail: "discounts_refunds_given", role: "discounts_given" },
  { name: "Uncategorized Income", type: "income", detail: "other_primary_income", role: "uncategorized_income" },
  { name: "Cost of Goods Sold", type: "cost_of_goods_sold", detail: "supplies_materials_cogs" },
  { name: "Advertising & Marketing", type: "expense", detail: "advertising_promotional" },
  { name: "Bank Fees & Service Charges", type: "expense", detail: "bank_charges" },
  { name: "Contract Labor", type: "expense", detail: "cost_of_labor" },
  { name: "Insurance", type: "expense", detail: "insurance" },
  { name: "Interest Paid", type: "expense", detail: "interest_paid" },
  { name: "Legal & Professional Services", type: "expense", detail: "legal_professional_fees" },
  { name: "Meals", type: "expense", detail: "entertainment_meals" },
  { name: "Office Supplies & Software", type: "expense", detail: "office_general_admin" },
  { name: "Rent & Lease", type: "expense", detail: "rent_or_lease_of_buildings" },
  { name: "Repairs & Maintenance", type: "expense", detail: "repair_maintenance" },
  { name: "Taxes & Licenses", type: "expense", detail: "taxes_paid" },
  { name: "Travel", type: "expense", detail: "travel" },
  { name: "Utilities", type: "expense", detail: "utilities" },
  { name: "Vehicle Expenses", type: "expense", detail: "auto" },
  { name: "Uncategorized Expense", type: "expense", detail: "other_miscellaneous_service_cost", role: "uncategorized_expense" },
  { name: "Interest Earned", type: "other_income", detail: "interest_earned" },
  { name: "Depreciation", type: "other_expense", detail: "depreciation" },
];

const equityByEntity: Record<EntityType, SeedAccount[]> = {
  sole_prop: [
    { name: "Owner's Investment", type: "equity", detail: "owners_equity" },
    { name: "Owner's Draw", type: "equity", detail: "owners_equity" },
  ],
  llc_single: [
    { name: "Owner's Investment", type: "equity", detail: "owners_equity" },
    { name: "Owner's Draw", type: "equity", detail: "owners_equity" },
  ],
  llc_multi: [
    { name: "Partner Contributions", type: "equity", detail: "partner_contributions" },
    { name: "Partner Distributions", type: "equity", detail: "partner_distributions" },
  ],
  partnership: [
    { name: "Partner Contributions", type: "equity", detail: "partner_contributions" },
    { name: "Partner Distributions", type: "equity", detail: "partner_distributions" },
  ],
  s_corp: [
    { name: "Common Stock", type: "equity", detail: "common_stock" },
    { name: "Shareholder Distributions", type: "equity", detail: "partner_distributions" },
    { name: "Officer Compensation", type: "expense", detail: "payroll_expenses" },
  ],
  c_corp: [
    { name: "Common Stock", type: "equity", detail: "common_stock" },
    { name: "Dividends Paid", type: "equity", detail: "partner_distributions" },
  ],
  nonprofit: [{ name: "Net Assets", type: "equity", detail: "owners_equity" }],
};

export function seedAccounts(entity: EntityType): SeedAccount[] {
  return [...common, ...equityByEntity[entity]];
}

export const DEFAULT_TERMS = [
  { name: "Due on receipt", dueDays: 0 },
  { name: "Net 15", dueDays: 15 },
  { name: "Net 30", dueDays: 30 },
  { name: "Net 60", dueDays: 60 },
];

/** Detail types offered per account type (stored as snake_case). */
export const DETAIL_TYPES: Record<AccountType, string[]> = {
  bank: ["checking", "savings", "money_market", "cash_on_hand", "trust_account"],
  accounts_receivable: ["accounts_receivable"],
  other_current_asset: ["undeposited_funds", "prepaid_expenses", "inventory", "loans_to_others", "employee_cash_advances", "other_current_assets"],
  fixed_asset: ["machinery_and_equipment", "vehicles", "furniture_and_fixtures", "buildings", "land", "leasehold_improvements", "accumulated_depreciation", "other_fixed_assets"],
  other_asset: ["security_deposits", "goodwill", "accumulated_amortization", "other_long_term_assets"],
  accounts_payable: ["accounts_payable"],
  credit_card: ["credit_card"],
  other_current_liability: ["sales_tax_payable", "payroll_liabilities", "line_of_credit", "loan_payable", "accrued_liabilities", "other_current_liabilities"],
  long_term_liability: ["notes_payable", "shareholder_notes_payable", "other_long_term_liabilities"],
  equity: ["owners_equity", "partner_contributions", "partner_distributions", "common_stock", "opening_balance_equity", "retained_earnings"],
  income: ["service_fee_income", "sales_of_product_income", "discounts_refunds_given", "other_primary_income"],
  cost_of_goods_sold: ["supplies_materials_cogs", "cost_of_labor_cogs", "shipping_freight_delivery_cogs", "other_costs_of_service_cogs"],
  expense: [
    "advertising_promotional", "auto", "bank_charges", "cost_of_labor", "dues_subscriptions", "entertainment_meals", "equipment_rental",
    "insurance", "interest_paid", "legal_professional_fees", "office_general_admin", "payroll_expenses", "rent_or_lease_of_buildings",
    "repair_maintenance", "shipping_freight_delivery", "supplies_materials", "taxes_paid", "travel", "utilities", "other_miscellaneous_service_cost",
  ],
  other_income: ["interest_earned", "dividend_income", "other_miscellaneous_income", "gain_loss_on_sale_of_assets"],
  other_expense: ["depreciation", "amortization", "penalties_settlements", "other_miscellaneous_expense"],
};

export function humanize(snake: string): string {
  const s = snake.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const BALANCE_SHEET_TYPES: ReadonlySet<AccountType> = new Set([
  "bank", "accounts_receivable", "other_current_asset", "fixed_asset", "other_asset",
  "accounts_payable", "credit_card", "other_current_liability", "long_term_liability", "equity",
]);
