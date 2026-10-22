-- Phase 1 schema for the books clone. Postgres 16.
-- Money: bigint cents, USD only in phase 1 (currency column kept for later).
-- Accounting dates: `date` (no time zone). Event times: timestamptz in UTC.
-- Access: data-layer checks. Every query is scoped by company_id after a
-- membership check; composite foreign keys stop rows from pointing across companies.

create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------- identity

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text,
  password_hash text,                       -- null for OAuth-only users
  email_verified timestamptz,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auth.js adapter tables (OAuth links, sessions, magic-link tokens)
create table auth_accounts (
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  provider text not null,
  provider_account_id text not null,
  refresh_token text, access_token text, expires_at integer,
  token_type text, scope text, id_token text, session_state text,
  primary key (provider, provider_account_id)
);
create index on auth_accounts (user_id);

create table sessions (
  session_token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires timestamptz not null
);
create index on sessions (user_id);

create table verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

-- ---------------------------------------------------------------- company

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  entity_type text not null default 'sole_prop'
    check (entity_type in ('sole_prop','llc_single','llc_multi','partnership','s_corp','c_corp','nonprofit')),
  address jsonb not null default '{}',
  email citext, phone text, ein text,
  home_currency char(3) not null default 'USD' check (home_currency = 'USD'),
  timezone text not null default 'America/New_York',   -- defines "today" for due dates
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  accounting_method text not null default 'accrual' check (accounting_method in ('accrual','cash')),
  close_date date,                                     -- books closed on and before this date
  close_password_hash text,
  invoice_defaults jsonb not null default '{}',        -- default terms, message, next number
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references users(id) on delete cascade, -- null while the invite is pending
  invited_email citext,
  role text not null check (role in ('owner','admin','standard','reports_only','accountant')),
  status text not null default 'active' check (status in ('invited','active','removed')),
  invite_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or invited_email is not null)
);
create unique index on memberships (company_id, user_id) where user_id is not null;
create index on memberships (user_id);

-- ---------------------------------------------------------------- lists

create table accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  parent_id uuid,
  name text not null,
  number text,
  type text not null check (type in (
    'bank','accounts_receivable','other_current_asset','fixed_asset','other_asset',
    'accounts_payable','credit_card','other_current_liability','long_term_liability',
    'equity','income','cost_of_goods_sold','expense','other_income','other_expense')),
  detail_type text not null,
  -- system accounts the posting engine needs; at most one of each per company
  system_role text check (system_role in (
    'accounts_receivable','accounts_payable','undeposited_funds','opening_balance_equity',
    'retained_earnings','sales_tax_payable','discounts_given','uncategorized_income',
    'uncategorized_expense','uncategorized_asset')),
  description text,
  active boolean not null default true,
  currency char(3) not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, parent_id) references accounts(company_id, id) on delete restrict
);
create unique index on accounts (company_id, lower(name), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'));
create unique index on accounts (company_id, number) where number is not null;
create unique index on accounts (company_id, system_role) where system_role is not null;
create index on accounts (company_id, type);
create index on accounts (parent_id);

create table terms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  due_days smallint check (due_days >= 0),
  day_of_month smallint check (day_of_month between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, name),
  check ((due_days is null) <> (day_of_month is null))
);

create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  agency text not null,
  rate_bp integer not null check (rate_bp between 0 and 10000), -- basis points: 8.25% = 825
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, name)
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('customer','vendor','employee','other')),
  display_name text not null,
  company_name text,
  first_name text, last_name text,
  emails citext[] not null default '{}',
  phone text,
  billing_address jsonb not null default '{}',
  shipping_address jsonb not null default '{}',
  terms_id uuid,
  tax_exempt boolean not null default false,
  default_tax_rate_id uuid,
  default_account_id uuid,                -- vendor: default expense category
  track_1099 boolean not null default false,
  tax_id text,
  parent_id uuid,                         -- sub-customer (phase 2 UI, schema now)
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, terms_id) references terms(company_id, id) on delete restrict,
  foreign key (company_id, default_tax_rate_id) references tax_rates(company_id, id) on delete restrict,
  foreign key (company_id, default_account_id) references accounts(company_id, id) on delete restrict,
  foreign key (company_id, parent_id) references contacts(company_id, id) on delete restrict
);
-- QBO rule: display names are unique across customers, vendors and employees
create unique index on contacts (company_id, lower(display_name));
create index on contacts (company_id, kind, active);
create index on contacts (terms_id);
create index on contacts (parent_id);

create table items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  sku text,
  type text not null check (type in ('service','non_inventory')), -- inventory, bundle: phase 3
  description text,
  sales_price_cents bigint check (sales_price_cents >= 0),
  income_account_id uuid,
  purchase_description text,
  purchase_cost_cents bigint check (purchase_cost_cents >= 0),
  expense_account_id uuid,
  taxable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, income_account_id) references accounts(company_id, id) on delete restrict,
  foreign key (company_id, expense_account_id) references accounts(company_id, id) on delete restrict,
  check (income_account_id is not null or expense_account_id is not null)
);
create unique index on items (company_id, lower(name));
create unique index on items (company_id, sku) where sku is not null;
create index on items (income_account_id);
create index on items (expense_account_id);

-- ---------------------------------------------------------------- transactions

create table transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  type text not null check (type in (
    'invoice','sales_receipt','payment','credit_memo','refund_receipt',
    'expense','check','bill','bill_payment','vendor_credit','credit_card_credit',
    'deposit','transfer','journal_entry','opening_balance')),
  number text,
  txn_date date not null,
  due_date date,
  contact_id uuid,
  terms_id uuid,
  -- the "money side" of the form: bank / credit card paid from or deposited to,
  -- A/R or A/P for invoices and bills. Lines carry the other side.
  account_id uuid,
  payment_method text,
  status text not null default 'posted' check (status in ('posted','voided')),
  memo text,                    -- shown to the customer / vendor
  private_note text,
  billing_address jsonb,
  email_to citext[],
  emailed_at timestamptz,
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_rate_id uuid,
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0,
  -- open amount for invoices, bills and credits; maintained by the posting engine
  balance_cents bigint not null default 0,
  currency char(3) not null default 'USD',
  source text not null default 'manual' check (source in ('manual','bank_feed','import','recurring','system')),
  public_token text unique,     -- customer-facing invoice link (phase 2)
  voided_at timestamptz,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, contact_id) references contacts(company_id, id) on delete restrict,
  foreign key (company_id, terms_id) references terms(company_id, id) on delete restrict,
  foreign key (company_id, account_id) references accounts(company_id, id) on delete restrict,
  foreign key (company_id, tax_rate_id) references tax_rates(company_id, id) on delete restrict,
  check (type not in ('invoice','sales_receipt','payment','credit_memo','refund_receipt',
                      'bill','bill_payment','vendor_credit') or contact_id is not null),
  check (balance_cents >= 0 and balance_cents <= greatest(total_cents, 0)),
  check (status <> 'voided' or (voided_at is not null and balance_cents = 0))
);
-- customer-facing numbers must be unique; vendor bill numbers are the vendor's and may repeat
create unique index txn_number_unique on transactions (company_id, type, number)
  where number is not null and type in ('invoice','sales_receipt','credit_memo','refund_receipt','journal_entry');
create index on transactions (company_id, type, txn_date desc);
create index on transactions (company_id, contact_id, txn_date desc);
create index on transactions (company_id, txn_date desc);
create index open_items on transactions (company_id, type, due_date) where balance_cents > 0 and status = 'posted';
create index on transactions (account_id);
create index on transactions (terms_id);
create index on transactions (tax_rate_id);
create index on transactions using gin (to_tsvector('simple', coalesce(number,'') || ' ' || coalesce(memo,'') || ' ' || coalesce(private_note,'')));

create table transaction_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  transaction_id uuid not null,
  position smallint not null,
  kind text not null check (kind in ('item','account','debit','credit')), -- debit/credit: journal entries
  item_id uuid,
  account_id uuid,              -- category, or the item's account resolved when saved
  description text,
  qty numeric(18,4),
  rate_cents numeric(18,4),     -- unit rate can have fractional cents; amount is rounded
  amount_cents bigint not null,
  taxable boolean not null default false,
  contact_id uuid,              -- JE name column; billable customer on expenses (phase 2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (transaction_id, position),
  foreign key (company_id, transaction_id) references transactions(company_id, id) on delete cascade,
  foreign key (company_id, item_id) references items(company_id, id) on delete restrict,
  foreign key (company_id, account_id) references accounts(company_id, id) on delete restrict,
  foreign key (company_id, contact_id) references contacts(company_id, id) on delete restrict,
  check (item_id is not null or account_id is not null),
  check (kind not in ('debit','credit') or amount_cents >= 0)
);
create index on transaction_lines (transaction_id);
create index on transaction_lines (item_id);
create index on transaction_lines (account_id);
create index on transaction_lines (contact_id);

-- The ledger. Every report reads from here. Written only by the posting engine.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  transaction_id uuid not null,
  line_id uuid,
  account_id uuid not null,
  entry_date date not null,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  contact_id uuid,              -- required on A/R and A/P entries, for aging
  memo text,
  reconcile_status text not null default 'uncleared'
    check (reconcile_status in ('uncleared','cleared','reconciled')),
  reconciliation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((debit_cents = 0) <> (credit_cents = 0)),
  foreign key (company_id, transaction_id) references transactions(company_id, id) on delete cascade,
  foreign key (company_id, account_id) references accounts(company_id, id) on delete restrict,
  foreign key (company_id, contact_id) references contacts(company_id, id) on delete restrict,
  foreign key (line_id) references transaction_lines(id) on delete set null
);
create index on ledger_entries (company_id, account_id, entry_date);
create index on ledger_entries (company_id, entry_date);
create index on ledger_entries (transaction_id);
create index on ledger_entries (contact_id, account_id);
create index on ledger_entries (reconciliation_id);
create index on ledger_entries (line_id);

-- Payments, credits and bill payments applied to invoices and bills
create table payment_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  source_txn_id uuid not null,  -- payment, credit_memo, bill_payment, vendor_credit
  target_txn_id uuid not null,  -- invoice or bill
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (source_txn_id, target_txn_id),
  foreign key (company_id, source_txn_id) references transactions(company_id, id) on delete cascade,
  foreign key (company_id, target_txn_id) references transactions(company_id, id) on delete restrict
);
create index on payment_applications (target_txn_id);

-- Undeposited-funds payments grouped into a bank deposit
create table deposit_items (
  deposit_txn_id uuid not null references transactions(id) on delete cascade,
  source_txn_id uuid not null unique references transactions(id) on delete restrict,
  primary key (deposit_txn_id, source_txn_id)
);

-- Per-company sequences for invoice and other numbers; locked with FOR UPDATE
create table number_sequences (
  company_id uuid not null references companies(id) on delete cascade,
  type text not null,
  next_value bigint not null default 1001,
  primary key (company_id, type)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  transaction_id uuid,
  storage_key text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 26214400), -- 25 MB
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (company_id, transaction_id) references transactions(company_id, id) on delete set null (transaction_id)
);
create index on attachments (transaction_id);
create index on attachments (company_id, created_at desc);

-- ---------------------------------------------------------------- banking

-- A ledger account that receives bank feed rows (CSV/OFX in phase 1, aggregator in phase 2)
create table bank_feed_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  account_id uuid not null,     -- bank or credit_card ledger account
  provider text not null default 'file' check (provider in ('file','plaid')),
  external_id text,
  institution_name text,
  mask text,
  start_date date,
  last_balance_cents bigint,    -- the bank's balance, for the "bank vs books" tile
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, account_id),
  foreign key (company_id, account_id) references accounts(company_id, id) on delete cascade
);

create table bank_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  feed_account_id uuid not null references bank_feed_accounts(id) on delete cascade,
  file_name text not null,
  format text not null check (format in ('csv','ofx','qfx','qbo')),
  column_map jsonb,
  rows_total integer not null default 0,
  rows_added integer not null default 0,
  rows_duplicate integer not null default 0,
  imported_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on bank_imports (feed_account_id, created_at desc);

create table bank_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  priority integer not null,                        -- lower runs first
  direction text not null check (direction in ('in','out','both')),
  feed_account_ids uuid[],                          -- null = all accounts
  match_mode text not null default 'all' check (match_mode in ('all','any')),
  -- [{"field":"description|bank_text|amount","op":"contains|not_contains|equals|gt|lt","value":"..."}]
  conditions jsonb not null check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) > 0),
  -- {"txn_type":"expense|deposit|transfer|check","contact_id":..,"memo":..,
  --  "splits":[{"account_id":..,"percent_bp":..|"amount_cents":..}]}
  actions jsonb not null,
  auto_confirm boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index on bank_rules (company_id, active, priority);

create table bank_feed_txns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  feed_account_id uuid not null references bank_feed_accounts(id) on delete cascade,
  import_id uuid references bank_imports(id) on delete set null,
  -- provider id, or for files a hash of (date, amount, description, occurrence n within the file)
  external_id text not null,
  posted_date date not null,
  description text not null,
  bank_text text,
  amount_cents bigint not null,                     -- + money in, - money out
  pending boolean not null default false,
  status text not null default 'for_review' check (status in ('for_review','categorized','excluded')),
  suggested jsonb,                                  -- rule- or match-based suggestion shown in S28
  rule_id uuid references bank_rules(id) on delete set null,
  matched_txn_id uuid,                              -- existing transaction it was matched to
  created_txn_id uuid,                              -- transaction created by "Add"
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feed_account_id, external_id),
  foreign key (company_id, matched_txn_id) references transactions(company_id, id) on delete set null (matched_txn_id),
  foreign key (company_id, created_txn_id) references transactions(company_id, id) on delete set null (created_txn_id),
  check (status <> 'categorized' or matched_txn_id is not null or created_txn_id is not null)
);
create index on bank_feed_txns (feed_account_id, status, posted_date desc);
create index on bank_feed_txns (company_id, status);
create index on bank_feed_txns (import_id);
create index on bank_feed_txns (rule_id);
create index on bank_feed_txns (matched_txn_id);
create index on bank_feed_txns (created_txn_id);

create table reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  account_id uuid not null,
  statement_date date not null,
  beginning_balance_cents bigint not null,          -- frozen from the previous reconciliation
  ending_balance_cents bigint not null,             -- from the statement
  service_charge_txn_id uuid,
  interest_txn_id uuid,
  status text not null default 'in_progress' check (status in ('in_progress','completed','undone')),
  completed_at timestamptz,
  completed_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, account_id) references accounts(company_id, id) on delete restrict,
  check (status <> 'completed' or completed_at is not null)
);
-- one open reconciliation per account
create unique index on reconciliations (account_id) where status = 'in_progress';
create index on reconciliations (account_id, statement_date desc);

alter table ledger_entries
  add foreign key (company_id, reconciliation_id) references reconciliations(company_id, id) on delete set null (reconciliation_id);

-- ---------------------------------------------------------------- audit

create table audit_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  entity text not null,
  entity_id uuid not null,
  action text not null check (action in ('create','update','delete','void','reconcile','unreconcile','close_override','login')),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index on audit_events (company_id, at desc);
create index on audit_events (company_id, entity, entity_id);

-- ---------------------------------------------------------------- integrity triggers

-- 1. Every transaction's ledger entries balance. Checked at commit, so the
--    posting engine can delete and re-insert entries inside one database transaction.
create or replace function check_txn_balanced() returns trigger language plpgsql as $$
declare t uuid; diff bigint;
begin
  t := coalesce(new.transaction_id, old.transaction_id);
  select coalesce(sum(debit_cents - credit_cents), 0) into diff
    from ledger_entries where transaction_id = t;
  if diff <> 0 then
    raise exception 'transaction % is out of balance by % cents', t, diff
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger ledger_balanced
  after insert or update or delete on ledger_entries
  deferrable initially deferred
  for each row execute function check_txn_balanced();

-- 2. Closed period. Writes on or before companies.close_date need
--    `set local app.close_override = 'on'` (set by the app after the password check, and audited).
create or replace function check_closed_period() returns trigger language plpgsql as $$
declare cd date; d date;
begin
  select close_date into cd from companies
   where id = coalesce(new.company_id, old.company_id);
  if cd is null or current_setting('app.close_override', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE','DELETE') and old.txn_date <= cd then
    raise exception 'transaction dated % is in a closed period (closed through %)', old.txn_date, cd
      using errcode = 'check_violation';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.txn_date <= cd then
    raise exception 'date % is in a closed period (closed through %)', new.txn_date, cd
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger transactions_closed_period
  before insert or update or delete on transactions
  for each row execute function check_closed_period();

-- 3. Reconciled entries are locked. Changing amount, account or date of a
--    reconciled entry, or deleting it, needs `set local app.reconciled_override = 'on'`
--    (the UI warns first, and it is audited).
create or replace function check_reconciled_lock() returns trigger language plpgsql as $$
begin
  if old.reconcile_status <> 'reconciled'
     or current_setting('app.reconciled_override', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE'
     or new.account_id <> old.account_id
     or new.debit_cents <> old.debit_cents
     or new.credit_cents <> old.credit_cents
     or new.entry_date <> old.entry_date then
    raise exception 'ledger entry % is reconciled and cannot change', old.id
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger ledger_reconciled_lock
  before update or delete on ledger_entries
  for each row execute function check_reconciled_lock();

-- updated_at on every table that has it
do $$
declare r record;
begin
  for r in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()',
                   r.table_name || '_updated_at', r.table_name);
  end loop;
end $$;

-- ---------------------------------------------------------------- reporting helpers

-- Account balances as of a date (accrual). Reports aggregate ledger_entries directly;
-- add a monthly summary table only if this gets slow.
create view account_balances as
select company_id, account_id,
       sum(debit_cents) as debit_cents,
       sum(credit_cents) as credit_cents,
       sum(debit_cents - credit_cents) as net_debit_cents
from ledger_entries
group by company_id, account_id;
