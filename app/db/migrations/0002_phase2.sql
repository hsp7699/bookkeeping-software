-- Phase 2: tracking (classes, locations, tags), estimates and purchase orders,
-- sales tax payments, billable expenses, recurring transactions, budgets,
-- reminders and receipts.

-- ---------------------------------------------------------------- tracking lists

create table classes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  parent_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, parent_id) references classes(company_id, id) on delete restrict
);
create unique index on classes (company_id, lower(name));

create table locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  parent_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, parent_id) references locations(company_id, id) on delete restrict
);
create unique index on locations (company_id, lower(name));

create table tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index on tags (company_id, lower(name));

create table transaction_tags (
  transaction_id uuid not null references transactions(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (transaction_id, tag_id)
);
create index on transaction_tags (tag_id);

-- Class is per line, location is per transaction (as in the original). Both are copied onto ledger entries for reporting.
alter table transactions add column location_id uuid;
alter table transactions add foreign key (company_id, location_id) references locations(company_id, id) on delete restrict;
create index on transactions (location_id);

alter table transaction_lines add column class_id uuid;
alter table transaction_lines add foreign key (company_id, class_id) references classes(company_id, id) on delete restrict;
create index on transaction_lines (class_id);

alter table ledger_entries add column class_id uuid references classes(id) on delete restrict;
alter table ledger_entries add column location_id uuid references locations(id) on delete restrict;
create index on ledger_entries (company_id, class_id) where class_id is not null;
create index on ledger_entries (company_id, location_id) where location_id is not null;

-- ---------------------------------------------------------------- new transaction types

alter table transactions drop constraint transactions_type_check;
alter table transactions add constraint transactions_type_check check (type in (
  'invoice','sales_receipt','payment','credit_memo','refund_receipt',
  'expense','check','bill','bill_payment','vendor_credit','credit_card_credit',
  'deposit','transfer','journal_entry','opening_balance',
  'estimate','purchase_order','sales_tax_payment'));

alter table transactions drop constraint transactions_check;
alter table transactions add constraint transactions_contact_required check (
  type not in ('invoice','sales_receipt','payment','credit_memo','refund_receipt',
               'bill','bill_payment','vendor_credit','estimate','purchase_order') or contact_id is not null);

drop index txn_number_unique;
create unique index txn_number_unique on transactions (company_id, type, number)
  where number is not null and type in ('invoice','sales_receipt','credit_memo','refund_receipt','journal_entry','estimate','purchase_order');

-- Estimates and purchase orders don't post. They track a status and what they turned into.
alter table transactions add column doc_status text
  check (doc_status in ('pending','accepted','rejected','closed','open'));
alter table transactions add column expires_on date;
-- the estimate an invoice came from, or the purchase order a bill came from
alter table transactions add column linked_from_id uuid;
alter table transactions add foreign key (company_id, linked_from_id) references transactions(company_id, id) on delete set null (linked_from_id);
create index on transactions (linked_from_id);

-- ---------------------------------------------------------------- billable expenses

alter table transaction_lines add column billable boolean not null default false;
-- the invoice line that billed this expense line to the customer
alter table transaction_lines add column billed_line_id uuid references transaction_lines(id) on delete set null;
create index on transaction_lines (contact_id) where billable and billed_line_id is null;
create index on transaction_lines (billed_line_id);

-- ---------------------------------------------------------------- recurring transactions

create table recurring_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  txn_type text not null check (txn_type in ('invoice','expense','check','bill','journal_entry','sales_receipt','transfer')),
  template jsonb not null,                       -- the save-pipeline input, minus dates and id
  interval_unit text not null check (interval_unit in ('week','month','year')),
  interval_count smallint not null default 1 check (interval_count between 1 and 52),
  day_of_month smallint check (day_of_month between 1 and 31),  -- 31 means "last day"
  start_date date not null,
  end_date date,
  next_date date,                                -- null when finished
  mode text not null default 'scheduled' check (mode in ('scheduled','reminder')),
  due_days smallint,                             -- invoice / bill due date offset
  auto_send boolean not null default false,      -- email invoices when created
  active boolean not null default true,
  last_run_at timestamptz,
  last_error text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index on recurring_templates (next_date) where active;

alter table transactions add column recurring_template_id uuid references recurring_templates(id) on delete set null;

-- ---------------------------------------------------------------- budgets

create table budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  fiscal_year integer not null check (fiscal_year between 2000 and 2200), -- the calendar year the fiscal year starts in
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, name)
);

create table budget_lines (
  budget_id uuid not null references budgets(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  period smallint not null check (period between 1 and 12), -- month of the fiscal year
  amount_cents bigint not null,
  primary key (budget_id, account_id, period)
);

-- ---------------------------------------------------------------- reminders, receipts, invites

create table reminders_sent (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  kind text not null check (kind in ('overdue','recurring_invoice','statement')),
  sent_to citext[] not null,
  sent_at timestamptz not null default now()
);
create index on reminders_sent (transaction_id, kind, sent_at desc);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  vendor_name text,
  txn_date date,
  amount_cents bigint,
  status text not null default 'review' check (status in ('review','matched','created')),
  txn_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, txn_id) references transactions(company_id, id) on delete set null (txn_id)
);
create index on receipts (company_id, status);

alter table memberships add column invited_by uuid references users(id) on delete set null;
alter table memberships add column invite_expires_at timestamptz;
create unique index on memberships (invite_token_hash) where invite_token_hash is not null;

-- updated_at triggers for the new tables
do $$
declare t text;
begin
  foreach t in array array['classes','locations','recurring_templates','budgets','receipts'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;
