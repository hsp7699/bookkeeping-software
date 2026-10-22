# Books

Double-entry bookkeeping for a small business: invoices, bills, bank feeds,
reconciliation and reports. It rebuilds QuickBooks Online's core features from
public sources (no code, assets or copy taken), as your own self-hosted app.
"Books" is a working name until it's rebranded.

- **app/**: the Next.js app (TypeScript, PostgreSQL)
- **deploy/**: Docker Compose stack for a single server, with HTTPS and backups
- **replica/**: the planning trail: recon map, feature matrix, architecture, design tokens, screenshots

## What it does

| Area | |
| --- | --- |
| Ledger | Double-entry for 18 transaction types. Every transaction balances, enforced by the database. Cash or accrual reporting, closed periods with a password, a full audit log. |
| Sales | Customers and sub-customers, products and services, invoices with tax and discounts, PDFs and email, receive payment (partial, several invoices at once), sales receipts, credit memos, refunds, applying credits. Estimates (with progress invoicing), billable expenses, customer statements, overdue reminders, your own logo, colour and footer on PDFs. |
| Expenses | Vendors, expenses with split categories, checks, bills, paying several bills at once, vendor credits, credit card credits, purchase orders, attachments, a receipts inbox. |
| Banking | Import CSV, OFX, QFX or QBO files (duplicates skipped). Review, categorize, split or match each line to an existing transaction or an open invoice or bill. Rules, transfers (detected across two connected accounts), reconciliation with history and undo. |
| Reports | Profit and loss (total, by month, class or location, or against the previous period or year), balance sheet, cash flow, trial balance, A/R and A/P aging, general ledger, sales by customer and by product, expenses by vendor, 1099 payments, sales tax liability, budget vs actuals. Drill-down from any number, CSV export, print. |
| Planning | Budgets by account and month, started blank or from last year's actuals. |
| Automation | Recurring invoices, expenses, bills, journal entries and transfers (created automatically or as reminders; invoices can email themselves). |
| Tax and tracking | Sales tax rates, liability report and payments, tax-exempt customers, 1099 vendors. Classes, locations and tags. |
| Team | Several companies per sign-in. Invite users as owner, admin, accountant, standard or reports-only. |
| Home | Cash, money owed both ways, net income, a 6-month income vs expenses chart, top expense categories. |

Not yet: live bank connections (Plaid, waiting on your keys), reading receipts
automatically, inventory, projects, Google sign-in, PDF export of reports.
Online invoice payment is left out on purpose. The full list, with what's done,
is in `replica/features.csv`.

Background jobs (recurring transactions and overdue reminders) run inside the
app every 15 minutes; set `JOBS=off` to turn them off. Emails (invoices,
statements, reminders, invitations) need `SMTP_URL` and `MAIL_FROM`; without them
you download PDFs and copy invite links instead. Set `APP_URL` to your public
address so invitation links point at it.

## Run it locally

Needs Node 22 and PostgreSQL 16.

```bash
cd app
cp .env.example .env.local          # set DATABASE_URL and AUTH_SECRET (openssl rand -base64 32)
npm install
npm run db:migrate                  # creates the tables
npm run dev                         # http://localhost:3000, then create your account

npm run seed:demo                   # optional: a demo company with 6 months of data
                                    # sign in as demo@example.com / demo-books-2026
```

Tests:

```bash
npm test                            # unit + database integration tests (uses DATABASE_URL)
npm run e2e                         # browser checks against a running app (BASE_URL, default :3100)
npm run typecheck && npx eslint src
```

## Put it on your own server

One small server (2 vCPU, 4 GB) runs everything: the app, Postgres, and Caddy,
which handles HTTPS for your domain automatically.

1. Point your domain (or a subdomain like `books.yourbusiness.com`) at the server with an A record.
2. On the server (Docker installed):
   ```bash
   git clone https://github.com/hsp7699/bookkeeping-software /opt/books
   cd /opt/books/deploy
   cp .env.example .env              # set DOMAIN, DB_PASSWORD, AUTH_SECRET
   docker compose up -d --build
   ```
3. Open `https://your-domain`, create your account and company.
4. Set `ALLOW_SIGNUP=false` in `.env` and run `docker compose up -d`, so nobody else can sign up.
5. Optional: set `SMTP_URL` and `MAIL_FROM` to email invoices through your own email provider.

Migrations run automatically every time the app container starts.

## Backups (do this before entering real books)

```bash
# nightly at 02:15, keeps 30 days in /var/backups/books, copies off-site if BACKUP_REMOTE is set (rclone)
echo "15 2 * * * root /opt/books/deploy/backup.sh >> /var/log/books-backup.log 2>&1" > /etc/cron.d/books-backup
/opt/books/deploy/backup.sh          # run once now to check it works
```

Restore (replaces everything; it asks you to type RESTORE first):

```bash
/opt/books/deploy/restore.sh /var/backups/books/books-<stamp>.dump /var/backups/books/storage-<stamp>.tgz
```

Do a test restore on a spare machine at least once. Backups you haven't
restored from aren't backups yet.

## How it's built

- **Next.js 15** (App Router, server actions), **Tailwind 4** with design tokens from `replica/design/tokens.json` (`npm run tokens`).
- **PostgreSQL 16** with plain SQL migrations in `app/db/migrations`. Three database
  triggers protect the books: every transaction's ledger entries balance, closed
  periods can't change without the password, and reconciled entries are locked.
- **Posting engine** (`app/src/lib/posting`): one pure function turns any transaction
  into ledger entries. It's tested on 2,000 random transactions to check they all balance.
- **Reports** (`app/src/lib/reports`): every report reads the ledger. Cash basis recognises
  invoice and bill lines when paid, in proportion, so cash and accrual reports both balance to the cent.
- **Auth.js** with email and password (argon2id), rate-limited sign-in, a role check on every
  page and action, and composite foreign keys so no record can point at another company's data.
- Money is always integer cents. Accounting dates are plain dates with no time zone.

More detail: `replica/architecture.md`.

## Security notes

- Every write goes through a membership and role check (`requireCompany`).
- Sessions are signed JWTs (14 days). Keep `AUTH_SECRET` secret; changing it signs everyone out.
- Attachments are stored on the server under random names and only served to signed-in members.
- Security headers are set (HSTS in production, frame-deny, nosniff).
- Turn off sign-up once your account exists (`ALLOW_SIGNUP=false`).
