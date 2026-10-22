# Build log: Phase 1

| Milestone | What shipped | Verified by |
| --- | --- | --- |
| Vertical slice | Sign-up, company setup with a US chart of accounts, customers, items, invoice, receive payment, P&L | `e2e/slice-invoice.mjs`: accrual net income $3,200, cash $1,000 after a partial payment |
| M2 Ledger & lists | Account create/edit/inactivate, sub-accounts, opening balances, register with running balance, audit log, customer edit | `e2e/m2-accounts.mjs` |
| M3 Sales | Sales receipts, credit memos, refunds, payment editing, void/delete, invoice PDF, email (SMTP), all-sales list | `e2e/m3-sales.mjs`, PDF rendered and checked by eye |
| M4 Expenses | Vendors, expenses with splits, checks, bills, pay several bills, vendor and card credits, attachments | `e2e/m4-expenses.mjs`: card, checking and A/P balances |
| M5 Money movement | Transfers, deposits from Undeposited Funds with fee lines, journal entries, settings, closing date with password | `e2e/m5-money.mjs`: closed period blocked, allowed with password, audited |
| M6 Bank feed | CSV/OFX/QFX/QBO import, dedupe, match to transactions / open invoices / bills, categorize with splits, transfers, rules (suggest or auto-add), batch accept, exclude, undo | `e2e/m6-banking.mjs`, 14 parser/rule unit tests |
| M7 Reconcile | Start, tick to zero, adjustment entry, history report, undo last, locked reconciled entries | `e2e/m7-reconcile.mjs`, DB integration tests |
| M8 Reports | Cash-basis ledger, P&L (by month), balance sheet, A/R and A/P aging, general ledger, drill-down, CSV, dashboard, search | `e2e/m8-reports.mjs` with the demo seed, DB integration tests (both bases balance to the cent) |
| M9 Hardening | Applying credits, rate-limited sign-in, security headers, standalone production build, Docker Compose + Caddy, backup and restore scripts | standalone server run against a fresh DB, checks re-run against it, restore drill identical |

Tests at the end of Phase 1: 71 unit and database integration tests, 9 browser checks.

## Decisions made along the way

- **Drizzle dropped** for plain `pg` with typed helpers: its schema introspection couldn't handle `citext`, and the SQL migrations are the source of truth anyway.
- **JWT sessions** instead of database sessions: Auth.js needs JWTs for email-and-password sign-in.
- **Reconciled transactions are locked**, not "warn and allow". Undoing the reconciliation unlocks them. Safer for your own books; easy to relax later.
- **Applying credits doesn't post** to the ledger (both sides already sit in A/R or A/P for the same name); on cash basis an applied credit recognises both documents together, so no cash appears to move.

## Bugs found and fixed by the checks

- `citext[]` columns came back from the driver as raw strings (the email "To" field showed `{`).
- The production build left out the PDF library's font files; PDFs failed only in production.
- The dashboard counted future-dated entries in "cash in the bank"; the balance sheet didn't.
- The import dialog kept the previous result when reopened.

# Build log: Phase 2

Scope: everything in the "should" column except online invoice payment (declined)
and live bank connections (waiting on the owner's Plaid keys).

| Step | What shipped | Verified by |
| --- | --- | --- |
| P2-1 Schema | Migration `0002_phase2.sql`: classes, locations, tags, recurring templates, budgets, reminders, receipts, invite columns, three new transaction types | migrations applied to a fresh database |
| P2-2 Reports + tax | Trial balance, cash flow, sales by customer and product, expenses by vendor, 1099 report, sales tax liability and payments, P&L by class/location and against the previous period or year | `e2e/p2-reports-tax.mjs`, DB integration tests |
| P2-3 Tracking | Classes per line, locations per transaction, tags | `e2e/p2-tracking.mjs` |
| P2-4 Documents | Estimates with progress invoicing, purchase orders to bills, billable expenses onto invoices, sub-customers, tax-exempt customers | `e2e/p2-docs.mjs`, DB integration tests |
| P2-5 Automation | Recurring templates (automatic or reminder, catch-up after downtime), overdue reminders, customer statements (balance forward / open item) with PDF and email, invoice logo, colour and footer | `e2e/p2-recurring.mjs`, runner and statement DB tests, schedule unit tests |
| P2-6 Team and extras | Budgets and budget vs actuals, user invitations and roles, company switcher, view-only mode, transfer detection across feed accounts, receipts inbox | `e2e/p2-team.mjs`, budget and transfer DB tests |

## Decisions

- **Background jobs run inside the app** (`instrumentation.ts`, every 15 minutes, a
  Postgres advisory lock so only one server runs them). No extra worker container.
- **Missed recurring runs are caught up** (up to 24 per template); resuming a paused
  template skips the dates it missed instead.
- **Invitations work with sign-ups turned off**: the signup form accepts a live invite
  token for the invited address only.
- **No receipt text extraction**: it needs an OCR service; you type vendor, date and amount.
- **A too-light invoice accent colour is refused** (WCAG 4.5:1 against white paper).
- **Not enough permission now redirects** to a "you don't have access" page instead of an error.

## Bugs found by the checks

- Recurring pause/resume and statement emails wrote audit actions the audit table doesn't allow.
- A reports-only user opening Settings directly got an application error.
- Budget section titles scrolled out of view in the wide month grid.
- The Users table said "Invited" twice for a pending invitation.
