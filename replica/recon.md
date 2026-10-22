# Recon map: QuickBooks Online (web)

Scope: full small-business accounting. Double-entry ledger with chart of
accounts; sales (customers, products/services, estimates, invoices, payments,
sales receipts, credit memos, sales tax); expenses (vendors, bills, bill
payments, expenses, checks, receipts); banking (bank feeds, rules, matching,
transfers, deposits, reconciliation); reports; budgets; classes/locations;
users and roles. Excludes payroll, payments processing as a service, and
Intuit's AI features (see Out of scope).
For: the user's own business (internal tool, single company, few users).
Date: 2026-10-22
Method: public sources only (the user chose not to use their own account).
No screenshots are saved: the app sits behind a login, and the public
images on marketing pages are Intuit's assets. Layouts below come from help
articles, training guides and the public API's structure. Confidence is
marked throughout.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | pricing page | https://quickbooks.intuit.com/pricing/ | plan tiers and gated features: Free, Simple Start, Essentials, Plus, Advanced |
| 2 | help: reconcile an account | https://quickbooks.intuit.com/learn-support/global/banking/reconcile-accounts/00/383017 | reconcile flow, difference to $0.00, history by account, reports |
| 3 | help: reconcile (UK) | https://quickbooks.intuit.com/learn-support/en-uk/statement-reconciliation/reconcile-an-account-in-quickbooks-online/00/239072 | unreconciling and editing statement info |
| 4 | help: bank rules (UK) | https://quickbooks.intuit.com/learn-support/en-uk/banking/how-to-set-up-bank-rules/00/1226445 | rule conditions (Description / Bank text / Amount; contains / doesn't contain / is exactly) and actions |
| 5 | community: bank rules | https://quickbooks.intuit.com/community/banking-27/how-to-set-up-bank-rules-297890 | rule setup walkthrough |
| 6 | third-party: bank-feed rules | https://kaufmanrossin.com/blog/quickbooks-online-tip-save-time-by-setting-up-rules-for-bank-feeds/ | bank feed review workflow |
| 7 | Intuit developer: API overview | https://developers.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api | API entities correspond to UI forms and lists, so the data model can be inferred from it |
| 8 | API entity list (third-party summary) | https://eazydi-doc.atlassian.net/wiki/x/RoAXAQ | Account, Customer, Vendor, Item, Invoice, Bill, Deposit, Transfer, JournalEntry, Purchase, SalesReceipt and more |
| 9 | IBM connector docs | https://www.ibm.com/docs/SS3LC4_7.5.4/com.ibm.wci.doc/QuickBooks_quickbooks_supported_objects.html | splits entities into transactions and name lists |
| 10 | Intuit student guide (CA) | https://www.intuit.com/oidam/intuit/ic/en_ca/content/Intuit-education-program-ca-qbo-ch2-getting-around-quickbooks-online.pdf | navigation, Quick Create (+), the customer and vendor centres |
| 11 | UKY QBO training | https://cafebusinesscenter.ca.uky.edu/files/ukces_quickbooks_online_training_fy20.pdf | older left nav: Banking, Sales, Expenses, Reports, Accounting |
| 12 | QBO welcome guide | https://media.intuit.com/en_US/QBO_welcome_guide_en_US/Content/Topics/guides/qbo_welcome_guide.htm | onboarding, navigation |
| 13 | community: nav change | https://quickbooks.intuit.com/community/reports-and-accounting-5/bookkeeping-where-is-this-elusive-heading-to-be-found-53951 | 2024 consolidated menu: Transactions > Banking, plus Sales, Expenses, Reports, Taxes |

Still to read before /replica-design: the public API reference pages for each
entity (developer.intuit.com blocks plain fetches, so read them in a
browser), and a public walkthrough video for each flow below to count clicks.

## Core loop

Record every money movement once, as balanced double-entry, mostly from bank
feeds and invoices, so that the P&L, balance sheet and tax numbers are always
right.

## Screens

Routes are proposals for the clone, not QBO's URLs.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign up / sign in | /login | account access | form, OAuth button | error, filled |
| S02 | Company setup wizard | first sign-in | name, industry, entity type, fiscal year start, tax form; seeds the chart of accounts | stepper, select, radio | empty, filled |
| S03 | Home dashboard | / | cash balance, P&L widget, expenses donut, invoices (unpaid / overdue / paid), bank account tiles, to-dos | KPI cards, charts, bank tiles | empty (new company), filled, loading |
| S04 | Quick Create (+) menu | global header | open any form from anywhere, grouped as Customers / Vendors / Employees / Other | menu grid | default |
| S05 | Global search | header | find transactions by number, amount or name; recent transactions | search box, results list | empty, results, no results |
| S06 | Chart of accounts | /accounts | list of accounts with type, detail type, balance; run report; edit; make inactive | data table, filters, row actions | filled, inactive shown |
| S07 | Account editor | /accounts/new (drawer) | name, account type, detail type, number, parent (sub-account), opening balance | drawer, select, date | new, edit, validation error |
| S08 | Account register | /accounts/:id/register | ledger rows with running balance, inline add/edit, reconcile status (R / C / blank) | editable grid | empty, filled, reconciled lock |
| S09 | Customers list | /customers | money bar (estimates, unbilled, overdue, open, paid last 30 days); customer table with open balance; batch actions | money bar, data table, checkbox batch | empty, filled, filtered |
| S10 | Customer detail | /customers/:id | transaction list, details tab, notes, statements | header card, tabs, table | filled, no transactions |
| S11 | Customer editor | drawer | name, company, emails, phone, billing / shipping address, terms, payment method, tax exempt, parent customer (sub-customer) | drawer form | new, edit, duplicate name error |
| S12 | Products & services | /items | item list: name, SKU, type (inventory / non-inventory / service / bundle), price, cost, qty on hand, income / expense accounts | table, type picker | empty, filled, low stock |
| S13 | Item editor | drawer | type-specific fields; inventory: qty, as-of date, reorder point, asset account | drawer form | per type |
| S14 | Invoice form | /invoices/new | customer, terms, dates, line items (item, description, qty, rate, amount, tax), discount, deposit, message, attachments; save, save and send, print | transaction form, line grid, totals block | new, edit, paid (locked fields), voided |
| S15 | Invoice email preview | modal from S14 | edit subject / body, see the PDF, send | modal, PDF preview | default, send error |
| S16 | Estimate form | /estimates/new | like S14 plus status (pending / accepted / closed / rejected), convert to invoice | transaction form | pending, accepted, converted |
| S17 | Receive payment | /payments/new | customer, date, method, deposit-to account, apply to open invoices, credits, unapplied amount | form, open-invoice checklist | no open invoices, partial, overpayment |
| S18 | Sales receipt | /sales-receipts/new | cash sale, paid on the spot | transaction form | new, edit |
| S19 | Credit memo / refund receipt | /credit-memos/new | credit a customer; refund money | transaction form | new, applied |
| S20 | Sales transactions list | /sales | all sales transactions; filters by type, status, date; status pills (overdue, paid, deposited) | table, filters, status pill | filled, filtered |
| S21 | Vendors list | /vendors | money bar (purchase orders, overdue bills, open bills, paid last 30 days); vendor table | money bar, table | empty, filled |
| S22 | Vendor detail / editor | /vendors/:id, drawer | contact, terms, 1099 tracking, default expense account | tabs, drawer | filled |
| S23 | Expense / check form | /expenses/new | payee, payment account, date, method, category lines and item lines, billable to customer, class / location | transaction form, two line grids | new, edit, billable |
| S24 | Bill form | /bills/new | vendor, terms, bill date, due date, bill no., lines | transaction form | open, partial, paid |
| S25 | Pay bills | /bills/pay | select open bills, pick payment account and date, total | checklist table, totals | none due, selected |
| S26 | Expense transactions list | /expenses | all purchases, bills, payments; filters | table, filters | filled |
| S27 | Purchase order | /purchase-orders/new | PO to vendor, convert to bill (Plus) | transaction form | open, closed |
| S28 | Bank transactions (feed) | /banking | account tiles (bank balance vs book balance); tabs For review / Categorized / Excluded; row: date, description, payee, category or match, amount, Add / Match | account carousel, tabs, expandable rows | no bank connected, nothing to review, many to review, match suggestion |
| S29 | Feed row expanded | inline in S28 | categorize (payee, category, class, memo, split) or find a match (search open invoices, bills, payments); transfer; record as credit card payment | inline form, split grid, match list | categorize, match, split |
| S30 | Connect bank | modal from S28 | find bank, aggregator OAuth, pick accounts, link to ledger account, start date | modal stepper | searching, linked, error |
| S31 | Upload transactions | from S28 | import CSV / QBO / OFX, map columns | file upload, column mapper | mapping, error, done |
| S32 | Bank rules | /banking/rules | list with priority order; editor: applies to money in / out, account, conditions (Description / Bank text / Amount; contains / doesn't contain / is exactly / greater / less), actions (type, payee, category, split by % or amount, class, memo), auto-confirm | sortable list, rule builder | empty, filled |
| S33 | Receipts inbox | /banking/receipts | upload or forward receipts; extracted vendor, date, amount; match to a feed transaction or create an expense | upload zone, review list | empty, processing, review |
| S34 | Reconcile start | /reconcile | pick account, statement ending date, ending balance; history link | form | first time, resume in progress |
| S35 | Reconcile workspace | /reconcile/:id | statement / beginning / cleared balances, Difference; Payments and Deposits tabs with checkboxes; Finish now / Save for later | sticky summary bar, checklist table | difference ≠ 0, difference = 0, done |
| S36 | Reconciliation history & report | /reconcile/history | past reconciliations per account; report shows cleared and uncleared items; undo the last one | table, report view | none, filled |
| S37 | Transfer / deposit / journal entry forms | Quick Create | move money between accounts; group undeposited funds into one deposit; manual debit / credit lines that must balance | transaction forms | unbalanced JE error |
| S38 | Reports center | /reports | standard reports by group (Favorites, Business overview, Who owes you, Sales and customers, What you owe, Expenses and vendors, Sales tax, Employees, For my accountant), plus custom and management reports | search, report cards | default |
| S39 | Report viewer | /reports/:key | date range, accounting method (cash / accrual), columns by month / class / customer, compare to previous period, filters, drill-down to transactions, export PDF / CSV / XLSX, save customization | report table with collapsible groups, toolbar | loading, no data, filled |
| S40 | Sales tax center | /taxes | agencies, rates, tax liability per period, record a tax payment, file status | table, period cards | not set up, due, paid |
| S41 | Budgets | /budgets | budget per fiscal year by account x month, optionally by class or customer; budget-vs-actual report | spreadsheet grid | empty, filled |
| S42 | Projects | /projects | project per customer: income, costs, profit; transactions tagged to it | cards, project tabs | empty, filled |
| S43 | Classes / locations / tags | /settings/lists | list management for tagging lines | list editors | empty, filled |
| S44 | Recurring transactions | /recurring | templates (scheduled / reminder / unscheduled) for invoices, bills, expenses, JEs | table, schedule editor | empty, filled |
| S45 | Settings: company / sales / expenses / advanced | /settings | company info, invoice defaults and customization, numbering, terms, accounting method, fiscal year, close-books date and password, track classes / locations, currency | tabbed settings, inline edit sections | default |
| S46 | Users & roles | /settings/users | invite users, roles (admin, standard all access, limited, reports only, time tracking), invite accountant | table, invite modal | pending invite, active |
| S47 | Audit log | /settings/audit | every add / edit / delete with user, time and before / after | table, filters | filled |
| S48 | Invoice customization | /settings/templates | logo, colours, fonts, fields shown, PDF preview | editor + preview | default |
| S49 | Customer-facing invoice page | public link | view invoice, download PDF, pay online | public page | unpaid, paid, overdue |
| S50 | Statements | from S09 batch | balance-forward / open-item / transaction statements per customer | form, preview | default |

## Flows

Happy-path click counts are estimates from the help articles. Count them for
real from a public walkthrough video before /replica-test.

```
F01 Set up the company
    S01 -> S02 -> S03
    happy path clicks: ~8
    edge: fiscal year not January, switching cash/accrual later, opening balances entered mid-year

F02 Create and send an invoice
    S03 -> S04 (+ Invoice) -> S14 -> S15 -> send
    happy path clicks: ~7 (pick customer, add 2 lines, save and send, send)
    edge: new customer inline, inventory item below zero qty, tax-exempt customer, discount before/after tax, deposit on invoice, email bounce

F03 Customer pays an invoice (recorded by hand)
    S09 -> row "Receive payment" -> S17 -> save
    happy path clicks: ~4
    edge: partial payment, overpayment leaves a credit, one payment across many invoices, payment to Undeposited Funds then grouped by F12

F04 Estimate to invoice
    S16 -> accept -> "Create invoice" -> S14
    happy path clicks: ~5
    edge: progress invoicing (bill part of an estimate), estimate edited after acceptance

F05 Record an expense
    S04 (+ Expense) -> S23 -> save
    happy path clicks: ~6
    edge: split across categories, billable to a customer (shows up as unbilled on the next invoice), receipt attached

F06 Enter a bill and pay it later
    S04 (+ Bill) -> S24 -> later S25 -> pay
    happy path clicks: ~9 across the two
    edge: partial payment, vendor credit applied, due-date terms, paying many bills at once

F07 Connect a bank and review the feed
    S28 -> S30 -> back to S28 -> per row: S29 -> Add/Match
    happy path clicks: ~3 per transaction once connected
    edge: duplicate import, a pending transaction changes amount, transfer between two connected accounts (both sides appear), a credit card payment, the match suggests the wrong invoice, undoing a categorized row

F08 Create a bank rule from a transaction
    S29 -> "Create rule" -> S32 editor -> save -> rows re-categorized
    happy path clicks: ~6
    edge: two rules match (priority order wins), auto-confirm vs suggest only, split by percentage

F09 Reconcile an account
    S34 -> S35 (tick cleared items until Difference = 0) -> finish -> S36
    happy path clicks: 3 + one per transaction
    edge: beginning balance doesn't match the last statement (a reconciled transaction was edited), save for later, undo the last reconciliation, a reconciled item edited afterwards (warn)

F10 Run the P&L and drill down
    S38 -> S39 -> change dates / method -> click an amount -> transaction list -> open the transaction
    happy path clicks: ~4
    edge: cash vs accrual difference, comparing periods, columns by month, a closed period

F11 Close the books
    S45 Advanced -> closing date + password
    happy path clicks: ~5
    edge: editing a transaction dated before the closing date asks for the password and is logged

F12 Make a deposit from Undeposited Funds
    S04 (+ Bank deposit) -> S37 -> tick payments -> save -> match to the feed
    happy path clicks: ~5
    edge: deposit includes a fee line, cash back

F13 Sales tax: charge, track, pay
    set up the agency (S40) -> invoices charge tax (S14) -> S40 period -> record payment
    happy path clicks: ~6
    edge: multiple jurisdictions (combined rate), tax-exempt customers, an adjustment

F14 Recurring invoice
    S14 -> "Make recurring" -> S44 schedule -> auto-sends
    happy path clicks: ~6
    edge: a month-end date, a customer deleted, changing the template mid-cycle

F15 Invite my accountant / a user
    S46 -> invite -> email -> accept
    happy path clicks: ~4
    edge: a reports-only user opening a form (permission denied)

F16 Budget vs actual
    S41 -> create the budget for a FY -> fill the grid -> S39 Budget vs Actuals
    happy path clicks: ~5 + data entry
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| App shell | left nav (collapsible), top bar with search, +New, settings gear, help | expanded, collapsed, mobile drawer | all |
| Button | primary, secondary, ghost, danger, split button (Save and send v) | default, hover, focus, disabled, loading | all |
| Transaction form | header (payee, dates, account), line grid, footer (memo, attachments), totals block, sticky action bar | new, edit, locked (closed period), voided | S14, S16-S19, S23-S24, S27, S37 |
| Line-item grid | product/service lines, category lines | add row, drag reorder, delete row, inline select, computed amount | transaction forms, S29 split, S41 |
| Combobox with "+ Add new" | customer, vendor, account, item, class | searching, empty, create-inline | all forms |
| Money input | | blank, negative, formatted, error | everywhere |
| Date picker | single, range with presets (This month, Last quarter, YTD...) | | forms, reports |
| Data table | sortable, selectable (batch actions), expandable rows, pagination, column settings | loading, empty, filtered-empty | lists |
| Money bar | segmented coloured bar with counts and totals | clickable filter | S09, S21 |
| Status pill | Overdue, Due in N days, Paid, Partially paid, Deposited, Draft, Voided, Pending, Accepted | | lists |
| Drawer | right slide-in editor | | S07, S11, S13, S22 |
| Modal | confirm, email preview, connect bank | | many |
| Toast | success, error, undo | | after save / delete |
| Report table | collapsible account groups, subtotals, drill-down links, sticky header | | S39 |
| KPI card / chart | number + trend, donut, bar | loading, empty | S03 |
| Bank account tile | bank balance, book balance, # to review, last updated | | S28, S03 |
| Rule builder | conditions list, actions list | | S32 |
| Reconcile summary bar | statement, cleared, difference (turns green at 0) | | S35 |
| File upload / attachment | drag-drop, list | uploading, failed | forms, S31, S33 |
| Empty state | illustration (our own), headline, CTA | | every list |

## Inferred data model

Names follow accounting convention, not Intuit's API. The design choice that
matters: every transaction posts balanced ledger lines, and every report reads
from the ledger.

```
Company        id, name, legal_name, address, fiscal_year_start_month, accounting_method (accrual|cash),
               home_currency, close_date, close_password_hash, tax_form
               evidence: S02, S45, help on closing books. confidence: high

User / Membership  user_id, company_id, role (admin|standard|limited|reports_only|accountant)
               evidence: S46, pricing (user counts, accountant seats). confidence: high

Account        id, name, number, type (Bank|AccountsReceivable|OtherCurrentAsset|FixedAsset|OtherAsset|
               AccountsPayable|CreditCard|OtherCurrentLiability|LongTermLiability|Equity|Income|
               CostOfGoodsSold|Expense|OtherIncome|OtherExpense), detail_type, parent_id, active,
               currency, description
               evidence: S06/S07, API Account entity (src 8). confidence: high (type list from memory of API, verify)

Contact        id, kind (customer|vendor|employee|other), display_name, company, emails[], phone,
               billing_addr, shipping_addr, terms_id, tax_exempt, parent_id (sub-customer), is_project,
               track_1099, default_account_id, active
               evidence: S11, S22, API Customer/Vendor. confidence: high

Item           id, name, sku, type (service|non_inventory|inventory|bundle), description, sales_price,
               income_account_id, purchase_cost, expense_account_id, taxable,
               qty_on_hand, reorder_point, asset_account_id, as_of_date
               evidence: S12/S13, API Item. confidence: high

Transaction    id, company_id, type (invoice|estimate|sales_receipt|payment|credit_memo|refund_receipt|
               expense|check|bill|bill_payment|vendor_credit|purchase_order|deposit|transfer|
               journal_entry|credit_card_credit|sales_tax_payment|inventory_adjustment),
               number, date, due_date, contact_id, terms_id, status, memo, private_note,
               total, balance (open amount), currency, exchange_rate, voided_at, created_by
               evidence: S14-S27, S37, API transaction entities (src 8, 9). confidence: high
               (one table + type is a design choice; QBO's API has one entity per type)

TransactionLine  id, transaction_id, position, item_id | account_id, description, qty, rate, amount,
               tax_code_id, class_id, location_id, customer_id (billable), billable_status
               evidence: S14, S23. confidence: high

LedgerEntry    id, transaction_id, line_id, account_id, date, debit, credit, contact_id, class_id,
               location_id, reconcile_status (uncleared|cleared|reconciled), reconciliation_id
               evidence: account register S08 (R/C column), JE form, reports drill down. confidence: high
               (the posting rules are standard double-entry; QBO's internals are not visible)
               invariant: sum(debit) = sum(credit) per transaction

PaymentApplication  id, payment_txn_id, target_txn_id (invoice|bill|credit), amount
               evidence: S17, S25. confidence: high

Terms          id, name, due_days | day_of_month. evidence: S11, S14. confidence: high
TaxAgency / TaxRate / TaxCode  agency, rate %, combined codes, liability account
               evidence: S40. confidence: medium (US flow is now automated sales tax; simplify to manual rates)
Class, Location, Tag  id, name, parent_id. evidence: pricing (Plus), S43. confidence: high

BankConnection id, provider (plaid|...), institution, status, last_sync_at
BankFeedAccount id, connection_id, external_id, ledger_account_id, start_date
BankFeedTxn    id, feed_account_id, external_id, date, description, bank_text, amount, pending,
               status (for_review|categorized|excluded), matched_txn_id, created_txn_id, rule_id
               evidence: S28-S31, src 4-6. confidence: high

BankRule       id, name, priority, direction (in|out), feed_account_ids, match (all|any),
               conditions [{field: description|bank_text|amount, op, value}],
               actions {txn_type, payee_id, splits [{account_id, pct|amount, class_id}], memo},
               auto_confirm
               evidence: src 4, 5. confidence: high

Reconciliation id, account_id, statement_date, statement_ending_balance, beginning_balance,
               status (in_progress|completed|undone), completed_at, completed_by
               evidence: src 2, 3, S34-S36. confidence: high

RecurringTemplate  id, txn_snapshot (json), schedule (interval, day, start, end), mode (scheduled|reminder|unscheduled), next_run_at
               evidence: S44. confidence: high
Budget / BudgetLine  fiscal_year, subdivide_by (none|class|location|customer); account_id, month, amount
               evidence: S41, pricing (Plus). confidence: high
Attachment     id, owner (txn | contact), file key, name, size. evidence: forms, S33. confidence: high
Receipt        id, attachment_id, extracted vendor/date/amount, status, matched_feed_txn_id
               evidence: S33. confidence: medium
AuditEvent     id, user_id, entity, entity_id, action, before (json), after (json), at
               evidence: S47. confidence: high
InvoiceTemplate  logo, colours, fields shown. evidence: S48. confidence: high
```

Relationships: Company 1-n Account, Contact, Item, Transaction. Transaction
1-n TransactionLine, 1-n LedgerEntry. Payment n-n Invoice through
PaymentApplication (same for BillPayment to Bill). Account 1-n Reconciliation
1-n LedgerEntry (cleared items). BankFeedAccount -> Account (ledger).
BankFeedTxn 0-1 Transaction (matched or created). Contact 0-n sub-customers.

## Feature matrix

See `features.csv`. Must: 55, should: 32, could: 17, skip: 10.

## Out of scope (cannot or should not be cloned)

- **Payroll.** Tax tables, filings and compliance in every jurisdiction. Use
  a payroll provider and post its journal entries.
- **QuickBooks Payments as a service.** Card and ACH processing is a
  regulated money-movement business. The clone takes payments through the
  user's own Stripe account instead.
- **Bill Pay money movement** (QBO sending ACH and checks for you). Same
  reason. The clone records bill payments and leaves sending the money to
  your bank.
- **Bank-connection network.** Intuit's direct bank links are partner deals.
  The clone uses an aggregator (Plaid, Teller, GoCardless) on the user's
  own account and keys, plus CSV/OFX import.
- **Automated sales-tax rate lookup and filing.** Needs a rate database
  (Avalara / TaxJar / Stripe Tax). Manual rates for v1.
- **Intuit Intelligence and the AI features**, the brand, the logos, the
  illustrations and the invoice template designs.
- **App marketplace and the ProAdvisor network.**
- **Data import from QuickBooks.** Possible later through the official API or
  QBO's own exports with your keys. Not part of recon.
- **Construction financials, Excel sync, 1099 e-filing.**

## Size

Screens 50, flows 16, entities ~25.

Hard parts:
1. **Ledger correctness.** Posting rules for 18 transaction types, edits and
   voids that re-post, cash- vs accrual-basis reports from the same ledger,
   the closed period. Get this wrong and every report is wrong.
2. **Bank feeds.** Aggregator integration, dedupe, pending vs posted, match
   suggestions (amount + date window + payee), rules, transfers that show
   on both sides.
3. **Reconciliation integrity.** Locking reconciled lines and detecting
   edits that break the beginning balance.
4. **Reports engine.** ~20 standard reports with grouping, period columns,
   comparisons, drill-down and export.
5. Inventory (FIFO costing), sales tax and multi-currency each add a lot.

Size: **XL as scoped.** The skill says to rescope at XL. Because this is for
your own business, the recommendation is phases rather than cuts:

- **Phase 1 (L): the books.** Chart of accounts, ledger, customers and
  vendors, invoices, payments, expenses, bills, JE / transfer / deposit,
  CSV bank import with categorize and match, rules, reconciliation, P&L,
  balance sheet, A/R and A/P aging, general ledger, audit log, closing
  date. Everything marked `must`.
- **Phase 2 (M):** a live bank aggregator, receipts, recurring
  transactions, sales tax, budgets, classes / locations, Stripe
  pay-online links, invoice customization. The `should` rows.
- **Phase 3:** inventory, projects, multi-currency, custom roles. The
  `could` rows.

Skip inventory and multi-currency entirely if your business doesn't need them.
