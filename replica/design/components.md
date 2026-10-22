# Components: Books

Tokens: `tokens.json`, exposed as CSS variables in `app/tokens.css` and as
Tailwind classes (`bg-surface`, `text-muted`, `border-input`...). No raw
hex in components. Icons: Lucide (ISC). Font: Inter (OFL). All copy is
written fresh. Base: Radix primitives where noted.

Global rules
- Every amount: `tabular-nums`, right-aligned, `$1,234.56`. Negatives show
  as `-$1,234.56` in `negative-amount`. Never colour alone: the minus sign
  always shows.
- Focus: `focus-visible` 2px ring, `focus-ring`, 2px offset, on every
  interactive element.
- Density: body 14px, table rows 40px (32px dense mode in registers and
  reports).
- Keyboard: every form saves with Ctrl/Cmd+S; Esc closes drawers and
  modals; `/` focuses global search; `n` opens Quick Create.

```
AppShell
  parts     left nav (nav-width 232 / collapsed 64), top bar (56px: company name, search, + New, settings, user menu), content (max 1440, 24px padding)
  states    nav expanded, collapsed (icons + tooltips), mobile (< lg: nav becomes a drawer behind a menu button)
  tokens    nav-bg, nav-text, nav-item-active / nav-text-active; content bg surface
  a11y      <nav aria-label="Main">, aria-current="page" on the active item, skip-to-content link first in the tab order
  used on   all
  nav       Home, Sales (Invoices, Customers, Products & services), Expenses (Expenses, Bills, Vendors), Banking (Transactions, Rules, Reconcile), Accounting (Chart of accounts, Journal entries), Reports, Settings

Button
  variants  primary, secondary (bg border text), ghost, danger, link
  sizes     sm 28px, md 36px, lg 44px
  states    default, hover (accent-hover), active, focus-visible, disabled (50% opacity, no pointer), loading (spinner replaces the icon, label stays, aria-busy)
  tokens    primary: bg accent, text on-accent; radius md; font base/600
  a11y      real <button type="button|submit">; icon-only buttons need aria-label
  used on   all

SplitButton  ("Save and send ▾")
  parts     primary action + menu trigger (Radix DropdownMenu) with Save and new, Save and close, Save and send, Print
  states    as Button; remembers the last choice per form type (localStorage)
  a11y      the trigger has aria-label "More save options"
  used on   S14, S16-S19, S23, S24, S37

TextField / Textarea
  sizes     md 36px
  states    default, hover, focus (border focus-ring + ring), disabled (surface bg), read-only (no border, text only), error (border danger + message below, aria-invalid, aria-describedby)
  tokens    border border-input, radius sm, text base
  a11y      always a visible <label>; required fields marked with text "(required)", not just *
  used on   all forms

MoneyInput
  behaviour accepts "1234.5", "1,234.50", "$1234.50", "(12.00)" (= -12.00); formats on blur; stores integer cents; right-aligned tabular-nums; arithmetic like "=12*3" evaluates on blur
  states    as TextField + negative not allowed (error) where the field forbids it
  used on   line grids, payment forms, reconcile, opening balance

DateField
  behaviour type or pick (Radix Popover + calendar grid); accepts 1/5, 1/5/26, 2026-01-05; "+"/"-" keys move a day; "t" = today (company time zone)
  states    default, open, error (invalid date), closed-period warning (warning-soft hint "This date is in a closed period")
  a11y      the calendar grid is arrow-key navigable, aria-label per day
  used on   all forms, reports

DateRangePicker
  presets   Today, This week, This month, This quarter, This fiscal year, Last month, Last quarter, Last fiscal year, Year to date, Custom
  used on   S39, lists

Combobox ("+ Add new")
  base      Radix Popover + listbox (or cmdk)
  behaviour type to filter; shows type/detail as secondary text (accounts: "Expense · Office supplies"); the last option is "+ Add new" which opens a mini-create inline or a Drawer and selects the new record on save; inactive records hidden
  states    closed, open, searching, empty ("No match. Add “xyz”?"), loading, error, disabled
  a11y      role=combobox, aria-expanded, aria-activedescendant, Enter selects, Esc closes
  used on   customer, vendor, account, item, terms, tax rate pickers

Select
  base      Radix Select. For short fixed lists (payment method, account type, role)

Checkbox / Radio / Switch
  base      Radix. Checkbox has an indeterminate state (select-all in tables, reconcile tabs)

DataTable
  base      TanStack Table
  features  sortable headers (aria-sort), row selection with a sticky batch-action bar, column visibility menu, pagination (50 per page) or "Load more", row click opens the record, row-level kebab menu (Radix DropdownMenu)
  states    loading (skeleton rows), empty (EmptyState), filtered-empty ("No results for these filters" + Clear filters), error (inline retry)
  tokens    header surface + text-muted xs/500 uppercase; rows bg, hover row-hover, selected row-selected; border-bottom border
  a11y      a real <table>; the selection checkbox per row has aria-label "Select invoice 1042"
  used on   S06, S09, S12, S20, S21, S26, S28, S35, S36, S38

LineGrid (editable lines on transaction forms)
  columns   #, product/service or category (Combobox), description, qty, rate, amount (MoneyInput), tax (checkbox), delete
  behaviour Tab moves cell to cell; Enter in the last row adds a row; always 2 empty rows at the end; drag handle to reorder; amount = qty × rate unless amount was typed (then rate = amount / qty); "Clear all lines"
  states    empty, filled, row error (red left border + message), read-only (voided or closed period)
  a11y      role=grid with aria-rowindex; the drag handle has keyboard alternatives (Alt+↑/↓)
  used on   S14, S16-S19, S23, S24, S29 (split), S37

TransactionForm (layout)
  parts     full-screen sheet: header bar (type title, number, close X, history clock), header fields grid (2-4 cols), "balance due" big number top right, LineGrid, footer (message / memo / attachments) with TotalsBlock on the right, sticky ActionBar (Cancel, Clear, Print, Make recurring (phase 2), More ▾, SplitButton)
  states    new, edit, paid / partially paid banner (info-soft), voided banner (danger-soft) with fields read-only, closed-period banner (warning-soft) asking for the password to edit, reconciled warning on save, conflict ("Changed by Sam at 3:42 PM. Reload?")
  a11y      the form heading is the H1; errors summarised at the top with links to the fields
  used on   S14, S16-S19, S23, S24, S27, S37

TotalsBlock
  rows      Subtotal, Discount (percent or amount), Taxable subtotal, Tax (rate select), Total, Amount received / Balance due
  tokens    tabular-nums, Total md/600

MoneyBar
  parts     segments with label, count and amount; each segment is a filter button for the table below
  customers Estimates (phase 2) · Unbilled (phase 2) · Overdue · Open invoices · Paid (last 30 days)
  vendors   Overdue bills · Open bills · Paid (last 30 days)
  colours   overdue warning, open accent, paid success. Each segment also has its label and count, so colour never carries meaning alone
  a11y      buttons with aria-pressed
  used on   S09, S21

StatusPill
  variants  overdue (danger-soft / on-danger-soft, "Overdue 12 days"), due (warning-soft, "Due in 3 days"), open (info-soft), partial (info-soft "Partially paid"), paid (success-soft), deposited (success-soft), voided (surface / text-muted, strikethrough amount), draft (surface)
  tokens    radius pill, xs/500, 20px tall
  used on   S20, S26, S10, S22, S14 header

Drawer
  base      Radix Dialog, slides in from the right, drawer-width 480 (full width under md)
  parts     title, close, scrollable body, sticky footer (Cancel, Save)
  states    open, saving, error, unsaved-changes confirm on close
  a11y      focus trapped, returns focus to the trigger, Esc closes (with the confirm if dirty)
  used on   S07, S11, S13, S22

Modal / ConfirmDialog
  base      Radix Dialog / AlertDialog
  variants  confirm, destructive (danger button, typed confirmation for "Delete company"), form (email preview S15, import S31, reconcile start S34)
  used on   many

Toast
  base      Radix Toast, bottom-left
  variants  success ("Invoice 1042 saved"), error, with an Undo action (5 s) for delete / exclude / categorise
  a11y      role=status (polite); errors role=alert

ReportTable
  parts     report header (company name, report title, date range, basis), toolbar (date range, basis toggle, columns: Total or Months, Compare previous period, Collapse / Expand, Export ▾, Print), the tree: section → account → sub-account rows with indent 16px per level, subtotal rows (600), grand total (double top border), every amount a drill-down link
  states    loading (skeleton), no data ("No activity in this period"), filled, stale (inputs changed, "Run report" highlighted)
  a11y      <table> with scope=row headers; collapse buttons with aria-expanded
  used on   S39

KPI card / Dashboard widget
  parts     title, period select, big number (xl tabular-nums), delta vs the previous period (with ▲/▼ and text, not colour alone), small chart
  charts    bar (P&L month over month), donut (expenses by category, 5 largest + Other), stacked bar (invoice buckets). Colours from the dataviz palette in phase 2; phase 1 uses accent + neutrals
  states    loading, empty (CTA: "Send your first invoice", "Import bank transactions")
  used on   S03

BankAccountTile
  parts     account name + mask, "In bank" (last imported balance), "In Books" (ledger), "N to review" (link), last updated
  states    selected (accent border), no import yet ("Import a file")
  used on   S28, S03

FeedRow (bank feed, expandable)
  collapsed date · description · payee · category or "1 match found" suggestion chip · spent · received · action button (Add / Match / View)
  expanded  radio: Categorize | Find match | Record transfer; Categorize: payee, category, memo, split link (LineGrid); Find match: candidate list with checkboxes and a running "difference" line; buttons: Add / Match, Exclude, Create rule from this
  states    for review, suggested by rule (rule name chip), match suggested, categorized (Undo), excluded (Undo)
  keyboard  ↑/↓ move between rows, Enter expands, Ctrl+Enter confirms
  used on   S28, S29

RuleBuilder
  parts     name, applies to (money in / out) + accounts, "all / any of these", condition rows (field · operator · value, add / remove), actions (type, payee, category or split by % / $, memo), auto-confirm switch, live preview: "Matches 14 transactions in For review"
  used on   S32

ReconcileSummaryBar
  parts     sticky under the header: Statement ending balance · Cleared balance (= beginning + deposits − payments) · Difference (big). Difference turns success with a check at 0.00; otherwise text
  actions   Edit info, Save for later, Finish now (disabled until difference = 0, or opens the "add adjustment?" dialog)
  a11y      the difference is announced (aria-live=polite) when it changes
  used on   S35

EmptyState
  parts     our own simple line illustration (or a Lucide icon in a 48px soft circle), H2, one sentence, a primary CTA, optional secondary link
  copy      fresh per screen, e.g. Customers: "No customers yet" · "Add the people and businesses you invoice." · [Add customer] [Import from CSV]

FileDrop / Attachments
  behaviour drag-drop or click; 25 MB per file; allowlist pdf, png, jpg, heic, csv, ofx, qfx, qbo; list with name, size, remove
  states    idle, drag-over (accent-soft), uploading (progress), failed (retry), done

Skeleton / Spinner
  skeleton  for tables and report rows; spinner only inside buttons
```

Primitive gallery: `/design` route in the app (dev only) renders every
component in every state, light theme. Dark theme is phase 2.
