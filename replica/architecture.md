# Architecture: Books (a rebuild of QuickBooks Online's core features), Phase 1

Working name "Books" until /replica-brand picks a real one. US / USD, one
company to start, multi-company ready, self-hosted.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Next.js 15 (App Router) + TypeScript, server actions for writes, route handlers for files and exports | one codebase for the UI and the API; server components keep ledger queries on the server |
| styling | Tailwind + tokens from /replica-design; headless UI from Radix | lots of dense tables and forms; Radix gives accessible comboboxes, menus and dialogs |
| tables / grids | TanStack Table; a small custom editable line grid | registers, lists and reports all need sorting, grouping and keyboard editing |
| database | PostgreSQL 16, self-hosted in Docker | the integrity rules (balanced entries, closed period, reconcile lock) are enforced in the database, see schema.sql |
| ORM | Drizzle, with `schema.sql` as the first migration (`drizzle-kit introspect` for types) | thin, SQL-shaped; reports drop to raw SQL easily |
| money math | integer cents (`bigint`) end to end; `dinero.js`-style helpers, no floats | no rounding drift |
| auth | Auth.js v5: email + password (argon2id) and optional Google; database sessions in Postgres | self-hosted, no third-party auth bill |
| email | Nodemailer over SMTP with your own provider (Postmark, SES or Fastmail) | invoices, password resets, invites |
| PDF | @react-pdf/renderer, server-side | invoice PDFs and report exports without headless Chrome |
| files | S3-compatible storage: MinIO in the same Docker Compose (swap for R2 / S3 later) | attachments and bank import files |
| bank import | OFX/QFX parser + CSV with a column mapper (phase 1); Plaid with your keys in phase 2 | phase 1 needs no third party |
| jobs | none needed in phase 1 except backups. pg-boss (Postgres-backed queue) when phase 2 adds recurring transactions and syncs | no Redis to run |
| payments | none in phase 1; your own Stripe account for "pay online" in phase 2 | |
| hosting | one VPS (Hetzner / DigitalOcean, 2 vCPU / 4 GB) running Docker Compose: `app`, `postgres`, `minio`, `caddy` (automatic HTTPS) | cheap and simple; one machine is plenty for one business |
| backups | nightly `pg_dump` + MinIO mirror to off-site object storage, 30 daily + 12 monthly; a restore drill before go-live | these are your books: backups are a must, not a should |
| tests | Vitest for the posting engine and reports (property tests: every posting balances); Playwright for flows | the posting engine is where bugs cost money |

No microservices. One app, one database.

## Schema

Tables: 24 (see `replica/schema.sql`, tested on Postgres 16).
Access rules: **data-layer checks.** Every server action calls
`requireCompany(session, companyId, minRole)`, which loads the membership,
then queries with `where company_id = $companyId`. Composite foreign keys
(`(company_id, x_id)`) make it impossible for a row to point at another
company's account, contact or transaction, even if a check is missed. RLS can
be added later as a second layer; it isn't needed for a single-owner install.

| group | tables |
| --- | --- |
| identity | users, auth_accounts, sessions, verification_tokens, memberships |
| company & lists | companies, accounts (chart of accounts), terms, tax_rates, contacts (customers + vendors), items |
| transactions | transactions (one table, 15 types), transaction_lines, ledger_entries, payment_applications, deposit_items, number_sequences, attachments |
| banking | bank_feed_accounts, bank_imports, bank_feed_txns, bank_rules, reconciliations |
| audit | audit_events |

Enforced in the database (all tested):

1. **Every transaction balances.** A deferred constraint trigger checks
   sum(debits) = sum(credits) per transaction at commit.
2. **Closed period.** Inserting, editing or deleting a transaction dated on
   or before `companies.close_date` fails unless the app sets
   `app.close_override` after the close-books password is checked. The
   override is audited.
3. **Reconciled entries are locked.** Changing the amount, account or date of
   a reconciled ledger entry, or deleting it, fails unless the app sets
   `app.reconciled_override` after the user confirms a warning. Also audited.
4. **No cross-company references**, through composite foreign keys.
5. Invoice, sales receipt, credit memo and refund receipt numbers are
   unique per company. Display names are unique across customers and
   vendors, as in QBO.
6. Only one reconciliation in progress per account. At most one system
   account per role (A/R, A/P, Undeposited Funds and so on).

### The posting engine (the heart of the app)

`lib/posting/` takes a transaction and its lines and returns ledger entries.
It is a pure function, unit-tested on its own. Saving a transaction runs in
one database transaction: upsert the transaction and lines, delete its
unreconciled ledger entries, insert the new ones, update open balances, write
an audit event, commit (where the balance trigger runs).

| type | debit | credit |
| --- | --- | --- |
| invoice | A/R (total, with customer) | income per line (item's income account); sales tax payable; discount: Dr discounts given |
| sales_receipt | deposit-to account (bank or Undeposited Funds) | income per line; sales tax payable |
| payment | deposit-to (bank or Undeposited Funds) | A/R (with customer); applications reduce invoice balances |
| credit_memo | income per line; sales tax payable | A/R (with customer) |
| refund_receipt | income per line | bank |
| expense / check | category or item expense account per line | bank or credit card |
| credit_card_credit | credit card | category per line |
| bill | category per line | A/P (with vendor) |
| bill_payment | A/P (with vendor) | bank or credit card |
| vendor_credit | A/P (with vendor) | category per line |
| deposit | bank (total) | Undeposited Funds (grouped payments) + other lines |
| transfer | to-account | from-account |
| journal_entry | debit lines | credit lines (must balance) |
| opening_balance | the account | Opening Balance Equity (or the reverse) |

Voiding keeps the transaction and its number but posts nothing and sets every
amount to 0, as QBO does. Deleting removes it (blocked if it is reconciled or
in a closed period, unless overridden).

**Retained earnings** is never posted. The balance sheet computes it as
income minus expenses before the current fiscal year start, and shows
current-year net income on its own line.

**Cash basis** is computed at report time, not stored. Income and expense
lines on invoices and bills are recognised when payments are applied, in
proportion (payment / invoice total) on the payment's date. Sales receipts,
expenses and checks are already cash. A/R and A/P disappear from a cash-basis
balance sheet. This is the trickiest report logic. It gets its own test
fixtures, checked by hand against worked examples.

## API

Server actions are POSTs under the hood. "Who" uses the roles owner > admin >
standard > accountant (same as standard plus close books) > reports_only.
Every action is company-scoped and audited.

### Onboarding and settings

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| action signUp | create user, start session | public | email, password, name | session | F01 |
| action signIn / signOut | Auth.js | public | credentials or Google | session | F01 |
| action createCompany | create company + seed the US chart of accounts by entity type + system accounts + default terms (Net 15/30/60, Due on receipt) | user | name, entity_type, fiscal_year_start, method | company id | F01 |
| action updateCompanySettings | company info, method, fiscal year, invoice defaults | admin | partial company | company | S45 |
| action setCloseDate | set or clear the closing date and password | admin, accountant | date, password | ok | F11 |
| action inviteUser / acceptInvite / removeUser | memberships | admin; invitee | email, role; token | membership | F15 |

### Lists

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /accounts (RSC) | chart of accounts with balances as of today | reports_only+ | filters | rows | S06 |
| action saveAccount / setAccountActive | create, edit, inactivate (blocked if the account is a system account or has an open balance and no replacement) | standard+ | account | account | S07 |
| action setOpeningBalance | creates an opening_balance transaction | standard+ | account, date, amount | txn | S07 |
| GET /accounts/:id/register | ledger rows with running balance, paged by date | reports_only+ | range, cursor | rows | S08 |
| action saveContact / setContactActive | customers and vendors | standard+ | contact | contact | S11, S22 |
| GET /customers, /vendors | list + money bar aggregates | reports_only+ | filters | rows, totals | S09, S21 |
| GET /customers/:id, /vendors/:id | detail + transactions | reports_only+ | | detail | S10, S22 |
| action saveItem / setItemActive | products and services | standard+ | item | item | S12, S13 |
| action saveTerms, saveTaxRate | small lists | admin | | | S45 |

### Transactions (one generic pipeline, one form per type)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| action saveTransaction | validate (zod schema per type), number it, post, update balances, audit. Optimistic concurrency on `updated_at` | standard+ | type, header, lines, applications, `if_updated_at` | txn | F02-F06, F12 |
| action voidTransaction | zero out and keep, rejects if reconciled without override | standard+ | id, overrides | txn | |
| action deleteTransaction | remove; cascades applications and restores invoice and bill balances | standard+ | id, overrides | ok | |
| GET /transactions/:id | the form's data + linked transactions (payments applied, deposit) | reports_only+ | | txn | all forms |
| GET /sales, /expenses | lists with type / status / date filters, status pills | reports_only+ | filters, cursor | rows | S20, S26 |
| GET /customers/:id/open-invoices, /vendors/:id/open-bills | for Receive Payment and Pay Bills | standard+ | | rows | F03, F06 |
| GET /deposits/undeposited | payments sitting in Undeposited Funds | standard+ | | rows | F12 |
| GET /invoices/:id/pdf | render the PDF | reports_only+ | | application/pdf | F02 |
| action sendInvoice | email the PDF over SMTP, set emailed_at | standard+ | id, to, subject, body | ok | F02 |
| POST /attachments | multipart upload to MinIO (25 MB cap, type allowlist) | standard+ | file, txn id | attachment | |
| GET /attachments/:id | signed redirect | reports_only+ | | 302 | |
| GET /search | global search: number, amount, contact name, memo | reports_only+ | q | rows | S05 |

### Banking

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| action createFeedAccount | link a bank or credit card ledger account to a file feed | admin | account id | feed | F07 |
| POST /bank/import (parse) | upload CSV / OFX / QFX, detect format, preview rows, propose column map | standard+ | file | preview | F07 |
| action commitImport | insert rows with dedupe (`external_id` = FITID for OFX, or a hash of date, amount, description and occurrence n for CSV), then run rules and match suggestions | standard+ | import id, column map | counts | F07 |
| GET /banking?account=&tab= | feed rows For review / Categorized / Excluded, with suggestions; bank vs books balances | standard+ | | rows | S28 |
| action addFeedTxn | create an expense / deposit / transfer / credit card payment from the row (with splits) and mark it categorized | standard+ | row id, payee, splits, memo | txn | F07 |
| action matchFeedTxn | link the row to existing transaction(s); a payment row can match a payment or settle open invoices directly | standard+ | row id, txn ids | ok | F07 |
| action excludeFeedTxn / undoFeedTxn | exclude, or undo back to For review (deleting the created txn if it was created from the feed and is unreconciled) | standard+ | row id | ok | F07 |
| action batchAccept | accept many rows' suggestions at once | standard+ | row ids | counts | F07 |
| action saveRule / reorderRules / deleteRule | rules CRUD; re-run on For review rows after a change | standard+ | rule | rule | F08 |
| action startReconciliation | statement date + ending balance; beginning balance = last completed reconciliation's ending balance | standard+ | account, date, balance | recon | F09 |
| action toggleCleared | set entries cleared / uncleared within the in-progress reconciliation | standard+ | recon id, entry ids, cleared | difference | F09 |
| action finishReconciliation | requires difference = 0 (or posts an adjustment JE after confirmation); marks entries reconciled | standard+ | recon id | report | F09 |
| action undoLastReconciliation | only the most recent; entries back to cleared | admin, accountant | recon id | ok | F09 |
| GET /reconcile/history, /reconcile/:id/report | history and the report (cleared, uncleared, changes since) | reports_only+ | | report | S36 |

### Reports

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /reports/:key | run a report: profit_and_loss, balance_sheet, ar_aging_summary, ar_aging_detail, ap_aging_summary, ap_aging_detail, general_ledger, transaction_detail_by_account, account_quick_report | reports_only+ | from, to, basis, columns (total or months), filters | report tree | F10 |
| GET /reports/:key/export?format=csv\|pdf | export | reports_only+ | same | file | F10 |
| GET /reports/drilldown | the transactions behind any report cell | reports_only+ | account, range, basis, filters | rows | F10 |
| GET /dashboard | cash in bank, P&L this month vs last, invoice buckets, expenses by category, bank tiles | reports_only+ | | widgets | S03 |
| GET /audit | audit log with filters | admin, accountant | filters | rows | S47 |

Webhooks in: none in phase 1. Webhooks out: none.
Jobs: nightly backup (cron on the host). Phase 2 adds pg-boss jobs for
recurring transactions, overdue reminders and Plaid sync.

## The parts that bite

- **Money and rounding.** Integer cents everywhere. Line amount =
  round(qty × rate) half-up, per line. Tax = round(taxable subtotal × rate)
  once per invoice, not per line, which matches how QBO shows it. Percent
  splits in rules: allocate the remainder cent to the last split so splits
  always sum to the total.
- **Dates and time zones.** Accounting dates are plain `date`s, never
  times, so a Dec 31 invoice can't slide into Jan 1. "Today" and "overdue"
  use the company's time zone. Fiscal-year math uses
  `fiscal_year_start_month`.
- **Edits to posted transactions.** Edits re-post: unreconciled entries are
  replaced. If a reconciled entry's amount, account or date would change,
  the database refuses it and the UI shows "this was reconciled, change
  anyway?". Changing it anyway sets the override and is audited. The next
  reconciliation start shows "beginning balance doesn't match" with a
  change list, from the audit log.
- **Races.** Two people editing one invoice: optimistic concurrency on
  `updated_at`, so the second save gets "this was changed by X". Invoice
  numbers: `number_sequences` row locked `FOR UPDATE` in the same
  transaction. Two payments applied to one invoice at once: lock the target
  invoices `FOR UPDATE` in id order before recomputing balances, with a
  check constraint so a balance can never go below 0.
- **Idempotency.** Bank imports dedupe on `(feed_account_id, external_id)`.
  Re-importing the same file adds 0 rows and reports them as duplicates. CSVs
  with two identical rows on the same day get an occurrence index, so both
  survive. Form submits carry a client-generated idempotency key, so a
  double-click doesn't create two invoices.
- **Undeposited Funds.** Payments default to Undeposited Funds. If the
  user then categorises the bank deposit as income instead of matching it,
  income counts twice. The match engine must suggest "group these
  payments" (sum of undeposited payments within ±5 days equal to the
  deposit) above "categorise".
- **Matching suggestions.** Candidates: same amount (exact), date within
  ±10 days, unmatched, same direction, preferring the payee name in the
  description. Show suggestions; never auto-match. Rules with
  `auto_confirm` only categorise.
- **Report performance.** Fine with direct aggregation on
  `(company_id, account_id, entry_date)` up to a few hundred thousand
  entries. Add a monthly balance table only if a report goes over ~500 ms.
- **Files.** 25 MB cap, an allowlist (pdf, png, jpg, heic, csv, ofx, qfx,
  qbo), stored under random keys, served through signed URLs, never from
  the public web root.
- **Security.** argon2id passwords, rate-limited sign-in, CSRF via server
  actions, every action company-scoped, the close password hashed
  separately, audit log append-only (no update or delete path in the app).
- **Backups and restore.** The single most important operational thing.
  Test a restore before entering real books.
- **Multi-tenancy.** company_id on everything plus composite FKs. The
  current company lives in the URL (`/c/:companyId/...`), so links are
  stable once there are several.
- **Data deletion.** Deleting a company cascades everything. Keep an export
  (CSV of every list and transaction) available first. For a business's
  own books that's a records-retention question, not GDPR.

## Build order

Each milestone ends with its tests green.

1. **Vertical slice: an invoice hits the P&L.** The ugly version, end to end.
   - Screens: S01, S02, S06 (read only), S11 (minimal), S14, S17, S39 (P&L only), S03 (stub)
   - Tables: users, sessions, companies, memberships, accounts, terms, contacts, items, transactions, transaction_lines, ledger_entries, payment_applications, number_sequences
   - Routes: signUp, signIn, createCompany (seeds the COA), saveContact, saveItem, saveTransaction (invoice, payment), GET /reports/profit_and_loss
   - Proves: the stack, the posting engine, the balance trigger, accrual P&L.
2. **Ledger and lists.** S06-S08 complete (accounts CRUD, sub-accounts,
   opening balances, register), S09-S13 complete, S04 Quick Create, the app
   shell and nav, the audit log (S47).
3. **Sales.** Invoice complete (tax, discount, PDF, email, print), sales
   receipt, credit memo, refund receipt, receive payment (partial, multiple
   invoices, credits), S20 list with status pills.
4. **Expenses.** Expense, check, bill, pay bills, vendor credit, credit card
   credit, S26 list, attachments.
5. **Money movement.** Transfer, deposit (Undeposited Funds), journal entry,
   void and delete, closed period (F11).
6. **Banking.** File feed accounts, CSV / OFX import with mapping and dedupe,
   For review / Categorized / Excluded, add with splits, match with
   suggestions, rules, batch accept (S28-S32).
7. **Reconcile.** S34-S36, adjustment, undo last, history report, the
   reconciled-edit warning.
8. **Reports.** Balance sheet (with computed retained earnings), cash basis,
   A/R and A/P aging, general ledger, transaction detail, account quick
   report, months as columns, drill-down, CSV / PDF export, the real
   dashboard (S03), global search (S05).
9. **Hardening.** Playwright for F01-F12, property tests on posting, a
   restore drill, deploy (/replica-deploy).

Then phase 2 (should-haves) and phase 3 (could-haves) from `features.csv`,
and the fixes once /replica-entrepreneur has run.
