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
