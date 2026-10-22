"use client";

import { GripVertical, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, MoneyInput, NativeSelect, Textarea, inputClass } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import { addDays } from "@/lib/dates";
import { formatCents, lineAmount } from "@/lib/money";
import { computeTotals } from "@/lib/posting";
import type { InvoiceDetail } from "@/lib/queries";
import { ApplyCredits } from "@/components/apply-credits";
import { Attachments } from "@/components/attachments";
import { ClassSelect, TrackingHeader, type Tracking } from "@/components/tracking-fields";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { EmailInvoiceDialog } from "./email-dialog";
import { listBillableAction, saveTransactionAction } from "../actions";
import { CustomerDrawer } from "@/components/contact-drawer";
import { ItemDrawer, type SavedItem } from "../items/item-drawer";

interface Option {
  id: string;
  name: string;
}
interface ItemOption {
  id: string;
  name: string;
  description: string | null;
  sales_price_cents: number | null;
  taxable: boolean;
}
export type SalesKind = "invoice" | "sales_receipt" | "credit_memo" | "refund_receipt" | "estimate";

const KIND: Record<SalesKind, { title: string; noun: string; path: string; numberLabel: string; big: string; dateLabel: string }> = {
  invoice: { title: "Invoice", noun: "invoice", path: "invoices", numberLabel: "Invoice no.", big: "Balance due", dateLabel: "Invoice date" },
  sales_receipt: { title: "Sales receipt", noun: "sales receipt", path: "sales-receipts", numberLabel: "Receipt no.", big: "Amount", dateLabel: "Sale date" },
  credit_memo: { title: "Credit memo", noun: "credit memo", path: "credit-memos", numberLabel: "Credit no.", big: "Credit amount", dateLabel: "Credit date" },
  refund_receipt: { title: "Refund receipt", noun: "refund", path: "refunds", numberLabel: "Refund no.", big: "Refund amount", dateLabel: "Refund date" },
  estimate: { title: "Estimate", noun: "estimate", path: "estimates", numberLabel: "Estimate no.", big: "Total", dateLabel: "Estimate date" },
};

export interface SalesPrefill {
  contactId: string;
  linkedFromId: string;
  taxRateId: string | null;
  discountCents: number;
  memo: string | null;
  lines: InvoiceDetail["lines"];
  note: string;
}

interface Billable {
  line_id: string;
  txn_id: string;
  txn_date: string;
  description: string | null;
  account: string;
  amount_cents: number;
}

const METHODS = ["Check", "ACH / bank transfer", "Credit card", "Cash", "Other"];

interface Props {
  kind: SalesKind;
  /** deposit-to (sales receipt) or paid-from (refund) choices */
  moneyAccounts: { id: string; name: string; system_role: string | null }[];
  companyId: string;
  today: string;
  customers: { id: string; display_name: string; email: string | null; terms_id: string | null; tax_exempt?: boolean; default_tax_rate_id?: string | null; parent_id?: string | null }[];
  items: ItemOption[];
  terms: { id: string; name: string; due_days: number | null }[];
  taxRates: { id: string; name: string; rate_bp: number }[];
  incomeAccounts: Option[];
  initial: InvoiceDetail | null;
  presetCustomerId?: string;
  tracking: Tracking;
  prefill?: SalesPrefill | null;
}

interface Line {
  key: number;
  /** lines that bill an expense have an income account instead of a product */
  accountId: string | null;
  classId: string | null;
  /** bills this billable expense line */
  billsLineId: string | null;
  itemId: string | null;
  description: string;
  qty: number | null;
  rateCents: number | null;
  amountCents: number | null;
  taxable: boolean;
}

let keySeq = 0;
const blank = (): Line => ({ key: ++keySeq, accountId: null, classId: null, billsLineId: null, itemId: null, description: "", qty: null, rateCents: null, amountCents: null, taxable: false });

function isEmpty(l: Line) {
  return !l.itemId && !l.accountId && !l.description && !l.amountCents;
}

/** Keep two empty rows at the end, like a spreadsheet. */
function withSpare(lines: Line[]) {
  let trailing = 0;
  for (let i = lines.length - 1; i >= 0 && isEmpty(lines[i]); i--) trailing++;
  const out = [...lines];
  while (trailing < 2) {
    out.push(blank());
    trailing++;
  }
  return out;
}

export function SalesForm(props: Props) {
  const { companyId, today, initial, kind } = props;
  const K = KIND[kind];
  const isInvoice = kind === "invoice";
  const isEstimate = kind === "estimate";
  const prefill = initial ? null : props.prefill ?? null;
  const hasMoneyAccount = kind === "sales_receipt" || kind === "refund_receipt";
  const base = `/c/${companyId}/${K.path}`;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState(props.customers);
  const [items, setItems] = useState(props.items);
  const [customerDrawer, setCustomerDrawer] = useState<string | null>(null);
  const [itemDrawer, setItemDrawer] = useState<{ name: string; lineKey: number } | null>(null);

  const defaultTerms = props.terms.find((t) => t.name === "Net 30")?.id ?? props.terms[0]?.id ?? null;
  const [contactId, setContactId] = useState<string | null>(initial?.contact_id ?? prefill?.contactId ?? props.presetCustomerId ?? null);
  const [email, setEmail] = useState(initial?.email_to?.[0] ?? customers.find((c) => c.id === props.presetCustomerId)?.email ?? "");
  const [txnDate, setTxnDate] = useState(initial?.txn_date ?? today);
  const [termsId, setTermsId] = useState<string | null>(initial ? initial.terms_id : defaultTerms);
  const [dueDate, setDueDate] = useState(initial?.due_date ?? addDays(today, props.terms.find((t) => t.id === defaultTerms)?.due_days ?? 30));
  const [number, setNumber] = useState(initial?.number ?? "");
  const [discount, setDiscount] = useState<number | null>(initial?.discount_cents || prefill?.discountCents || null);
  const [taxRateId, setTaxRateId] = useState<string>(initial?.tax_rate_id ?? prefill?.taxRateId ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? prefill?.memo ?? "");
  const [expiresOn, setExpiresOn] = useState(initial?.expires_on ?? addDays(today, 30));
  const [docStatus, setDocStatus] = useState(initial?.doc_status ?? "pending");
  const [billable, setBillable] = useState<Billable[]>([]);
  const [billableIncomeId, setBillableIncomeId] = useState<string | null>(null);
  const linkedFromId = initial?.linked_from_id ?? prefill?.linkedFromId ?? null;
  const [privateNote, setPrivateNote] = useState(initial?.private_note ?? "");
  const [accountId, setAccountId] = useState(initial?.account_id ?? props.moneyAccounts[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState(initial?.payment_method ?? "Check");
  const [closePassword, setClosePassword] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(initial?.location_id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tag_ids ?? []);
  const [emailOpen, setEmailOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(() =>
    withSpare(
      (initial?.lines ?? prefill?.lines ?? []).map((l) => ({
        key: ++keySeq,
        accountId: l.item_id ? null : l.account_id,
        classId: l.class_id,
        billsLineId: l.bills_line_id,
        itemId: l.item_id,
        description: l.description ?? "",
        qty: l.qty,
        rateCents: l.rate_cents,
        amountCents: l.amount_cents,
        taxable: l.taxable,
      })),
    ),
  );

  // Terms drive the due date
  function applyTerms(tid: string | null, date = txnDate) {
    const t = props.terms.find((x) => x.id === tid);
    if (t?.due_days != null) setDueDate(addDays(date, t.due_days));
  }

  function pickCustomer(id: string | null) {
    setContactId(id);
    const c = customers.find((x) => x.id === id);
    if (c) {
      if (c.tax_exempt) setTaxRateId("");
      else if (c.default_tax_rate_id) setTaxRateId(c.default_tax_rate_id);
      if (c.email) setEmail(c.email);
      if (c.terms_id) {
        setTermsId(c.terms_id);
        applyTerms(c.terms_id);
      }
    }
  }

  // Billable expenses waiting to be billed to this customer
  useEffect(() => {
    if (!isInvoice || !contactId) {
      setBillable([]);
      return;
    }
    let off = false;
    listBillableAction(companyId, contactId).then((r) => {
      if (off) return;
      setBillable(r.lines);
      setBillableIncomeId(r.incomeAccountId);
    });
    return () => {
      off = true;
    };
  }, [companyId, contactId, isInvoice]);

  function addBillable(b: Billable) {
    const incomeAccountId = billableIncomeId;
    setLines((ls) =>
      withSpare([
        ...ls.filter((l) => !isEmpty(l)),
        { key: ++keySeq, accountId: incomeAccountId, classId: null, billsLineId: b.line_id, itemId: null, description: b.description || `${b.account} (${b.txn_date})`, qty: 1, rateCents: b.amount_cents, amountCents: b.amount_cents, taxable: false },
      ]),
    );
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => withSpare(ls.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  }

  function pickItem(key: number, itemId: string | null, list = items) {
    const it = list.find((i) => i.id === itemId);
    if (!it) return updateLine(key, { itemId });
    const qty = 1;
    const rate = it.sales_price_cents;
    updateLine(key, {
      itemId,
      description: it.description ?? "",
      qty,
      rateCents: rate,
      amountCents: rate != null ? lineAmount(qty, rate) : null,
      taxable: it.taxable,
    });
  }

  const filled = lines.filter((l) => !isEmpty(l));
  const taxRate = props.taxRates.find((t) => t.id === taxRateId) ?? null;
  const totals = useMemo(() => {
    try {
      return computeTotals(
        filled.map((l) => ({ accountId: "", amountCents: l.amountCents ?? 0, taxable: l.taxable })),
        discount ?? 0,
        taxRate?.rate_bp ?? null,
      );
    } catch {
      return computeTotals(filled.map((l) => ({ accountId: "", amountCents: l.amountCents ?? 0, taxable: l.taxable })), 0, taxRate?.rate_bp ?? null);
    }
  }, [filled, discount, taxRate]);
  const paid = initial ? initial.total_cents - initial.balance_cents : 0;
  const balanceDue = totals.totalCents - paid;

  function save(then: "close" | "new" | "stay") {
    setError(null);
    const bad = filled.find((l) => !l.itemId && !l.accountId);
    if (bad) return setError(`Line ${filled.indexOf(bad) + 1}: choose a product or service.`);
    const payload = {
      type: kind,
      id: initial?.id,
      ifUpdatedAt: initial?.updated_at,
      contactId,
      txnDate,
      dueDate: isInvoice ? dueDate : null,
      expiresOn: isEstimate ? expiresOn : null,
      docStatus: isEstimate && docStatus !== "closed" ? docStatus : undefined,
      linkedFromId,
      termsId: isInvoice ? termsId : null,
      accountId: hasMoneyAccount ? accountId || null : null,
      paymentMethod: hasMoneyAccount ? paymentMethod : null,
      number: number.trim() || null,
      locationId,
      tagIds,
      lines: filled.map((l) => ({
        classId: l.classId,
        billsLineId: l.billsLineId,
        itemId: l.itemId,
        accountId: l.itemId ? null : l.accountId,
        description: l.description || null,
        qty: l.qty,
        rateCents: l.rateCents,
        amountCents: l.amountCents ?? 0,
        taxable: l.taxable,
      })),
      discountCents: discount ?? 0,
      taxRateId: taxRateId || null,
      memo: memo || null,
      privateNote: privateNote || null,
      emailTo: email ? [email] : [],
    };
    if (!contactId) return setError("Choose a customer.");
    if (filled.length === 0) return setError("Add at least one line.");
    start(async () => {
      const res = await saveTransactionAction(companyId, payload, closePassword ?? undefined);
      if (!res.ok) {
        if (res.error.includes("closed period") && closePassword == null) setClosePassword("");
        return setError(res.error);
      }
      if (then === "new") {
        router.push(`${base}/new?saved=${res.data.number ?? ""}`);
        router.refresh();
      } else if (then === "close") router.push(`/c/${companyId}/sales`);
      else {
        router.replace(`${base}/${res.data.id}?saved=1`);
        router.refresh();
      }
    });
  }

  // Ctrl/Cmd+S saves
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        document.getElementById("invoice-save")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const itemOptions = items.map((i) => ({ value: i.id, label: i.name, hint: i.sales_price_cents != null ? formatCents(i.sales_price_cents) : undefined }));
  const customerOptions = customers.map((c) => ({ value: c.id, label: c.display_name, hint: c.email ?? undefined }));
  const status =
    initial?.status === "voided" ? (
      <StatusPill tone="voided">Voided</StatusPill>
    ) : isEstimate && initial ? (
      <StatusPill tone={initial.doc_status === "closed" ? "paid" : initial.doc_status === "rejected" ? "voided" : initial.doc_status === "accepted" ? "partial" : "open"}>
        {{ pending: "Pending", accepted: "Accepted", rejected: "Rejected", closed: "Closed" }[initial.doc_status ?? "pending"]}
      </StatusPill>
    ) : !isInvoice ? null : initial && initial.balance_cents === 0 ? (
      <StatusPill tone="paid">Paid</StatusPill>
    ) : initial && paid > 0 ? (
      <StatusPill tone="partial">Partially paid</StatusPill>
    ) : null;

  return (
    <div className="-m-6 flex min-h-[calc(100dvh-var(--header-height))] flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{initial ? `${K.title} ${initial.number ?? ""}` : `New ${K.noun}`}</h1>
          {status}
        </div>
        <Link href={`/c/${companyId}/sales`} className="rounded-sm p-1 text-text-muted hover:bg-row-hover" aria-label="Close">
          <X className="size-5" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        {closePassword != null && (
          <div className="mb-4 flex max-w-sm items-end gap-2">
            <Field label="Close-books password" className="flex-1">
              {(p) => <Input {...p} type="password" value={closePassword} onChange={(e) => setClosePassword(e.target.value)} />}
            </Field>
          </div>
        )}
        {prefill && (
          <p role="status" className="mb-4 rounded-md bg-info-soft px-3 py-2 text-on-info-soft">
            {prefill.note}
          </p>
        )}
        {isInvoice && billable.some((b) => !lines.some((l) => l.billsLineId === b.line_id)) && (
          <section aria-label="Billable expenses" className="mb-4 rounded-md border border-border bg-info-soft/40 p-4">
            <h2 className="mb-2 font-semibold">Billable expenses for this customer</h2>
            <ul className="flex flex-col gap-1.5">
              {billable
                .filter((b) => !lines.some((l) => l.billsLineId === b.line_id))
                .map((b) => (
                  <li key={b.line_id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {b.txn_date} · {b.account}
                      {b.description ? ` · ${b.description}` : ""} <span className="num font-medium">{formatCents(b.amount_cents)}</span>
                    </span>
                    <Button size="sm" onClick={() => addBillable(b)}>
                      Add
                    </Button>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {initial?.status === "voided" && (
          <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">This {K.noun} is voided. It stays in your records but doesn&apos;t affect your books.</p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Customer" required className="sm:col-span-2">
              {(p) => (
                <Combobox
                  {...p}
                  options={customerOptions}
                  value={contactId}
                  onChange={pickCustomer}
                  placeholder="Choose a customer"
                  onAddNew={(typed) => setCustomerDrawer(typed)}
                  addNewLabel="Add new customer"
                />
              )}
            </Field>
            <Field label="Customer email" className="sm:col-span-2">
              {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            {isInvoice && (
            <Field label="Terms">
              {(p) => (
                <NativeSelect
                  {...p}
                  value={termsId ?? ""}
                  onChange={(e) => {
                    setTermsId(e.target.value || null);
                    applyTerms(e.target.value || null);
                  }}
                >
                  <option value="">None</option>
                  {props.terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            )}
            {hasMoneyAccount && (
              <>
                <Field label={kind === "sales_receipt" ? "Deposit to" : "Refund from"}>
                  {(p) => (
                    <NativeSelect {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      {props.moneyAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Payment method">
                  {(p) => (
                    <NativeSelect {...p} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      {METHODS.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </>
            )}
            {isEstimate && (
              <>
                <Field label="Expiration date">{(p) => <Input {...p} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}</Field>
                <Field label="Status">
                  {(p) => (
                    <NativeSelect {...p} value={docStatus} disabled={docStatus === "closed"} onChange={(e) => setDocStatus(e.target.value)}>
                      <option value="pending">Pending</option>
                      <option value="accepted">Accepted</option>
                      <option value="rejected">Rejected</option>
                      {docStatus === "closed" && <option value="closed">Closed (fully invoiced)</option>}
                    </NativeSelect>
                  )}
                </Field>
              </>
            )}
            <Field label={K.dateLabel}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={txnDate}
                  onChange={(e) => {
                    setTxnDate(e.target.value);
                    applyTerms(termsId, e.target.value);
                  }}
                />
              )}
            </Field>
            {isInvoice && <Field label="Due date">{(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>}
            <Field label={K.numberLabel} hint={initial ? undefined : "Leave blank for the next number"}>
              {(p) => <Input {...p} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={21} />}
            </Field>
          </div>
          <div className="min-w-48 text-right">
            <p className="text-sm font-medium tracking-wide text-text-muted uppercase">{K.big}</p>
            <p className="num text-display font-bold">{formatCents(balanceDue)}</p>
          </div>
        </div>

        <TrackingHeader tracking={props.tracking} locationId={locationId} onLocation={setLocationId} tagIds={tagIds} onTags={setTagIds} />

        {/* Line grid */}
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse" aria-label={`${K.title} lines`}>
            <thead>
              <tr className="text-left text-xs font-medium tracking-wide text-text-muted uppercase">
                <th className="w-8" />
                <th className="w-8 px-1 py-2">#</th>
                <th className="w-64 px-1 py-2">Product or service</th>
                <th className="px-1 py-2">Description</th>
                <th className="w-20 px-1 py-2 text-right">Qty</th>
                <th className="w-32 px-1 py-2 text-right">Rate</th>
                <th className="w-32 px-1 py-2 text-right">Amount</th>
                <th className="w-12 px-1 py-2 text-center">Tax</th>
                {props.tracking.classes.length > 0 && <th className="w-36 px-1 py-2">Class</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={l.key} className="border-t border-border align-top">
                  <td className="pt-3 text-text-subtle">
                    <GripVertical className="size-4" aria-hidden />
                  </td>
                  <td className="px-1 pt-2.5 text-text-muted">{idx + 1}</td>
                  <td className="px-1 py-1.5">
                    {l.billsLineId || (!l.itemId && l.accountId) ? (
                      <span className="flex h-9 items-center rounded-sm bg-surface px-2.5 text-text-muted">{l.billsLineId ? "Billable expense" : "Other income"}</span>
                    ) : (
                    <Combobox
                      aria-label={`Line ${idx + 1} product or service`}
                      options={itemOptions}
                      value={l.itemId}
                      onChange={(v) => pickItem(l.key, v)}
                      placeholder="Choose"
                      onAddNew={(typed) => setItemDrawer({ name: typed, lineKey: l.key })}
                      addNewLabel="Add new"
                    />
                    )}
                  </td>
                  <td className="px-1 py-1.5">
                    <Input
                      aria-label={`Line ${idx + 1} description`}
                      value={l.description}
                      onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      aria-label={`Line ${idx + 1} quantity`}
                      inputMode="decimal"
                      className={cn(inputClass, "num")}
                      value={l.qty ?? ""}
                      onChange={(e) => {
                        const qty = e.target.value === "" ? null : Number(e.target.value);
                        if (qty != null && Number.isNaN(qty)) return;
                        updateLine(l.key, { qty, amountCents: qty != null && l.rateCents != null ? lineAmount(qty, l.rateCents) : l.amountCents });
                      }}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <MoneyInput
                      aria-label={`Line ${idx + 1} rate`}
                      value={l.rateCents}
                      onValueChange={(rate) =>
                        updateLine(l.key, { rateCents: rate, qty: l.qty ?? (rate != null ? 1 : null), amountCents: rate != null ? lineAmount(l.qty ?? 1, rate) : l.amountCents })
                      }
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <MoneyInput
                      aria-label={`Line ${idx + 1} amount`}
                      allowNegative
                      value={l.amountCents}
                      onValueChange={(amount) =>
                        updateLine(l.key, {
                          amountCents: amount,
                          rateCents: amount != null && l.qty ? amount / l.qty : amount,
                          qty: l.qty ?? (amount != null ? 1 : null),
                        })
                      }
                    />
                  </td>
                  <td className="px-1 pt-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Line ${idx + 1} taxable`}
                      checked={l.taxable}
                      onChange={(e) => updateLine(l.key, { taxable: e.target.checked })}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                  </td>
                  {props.tracking.classes.length > 0 && (
                    <td className="px-1 py-1.5">
                      <ClassSelect label={`Line ${idx + 1} class`} classes={props.tracking.classes} value={l.classId} onChange={(v) => updateLine(l.key, { classId: v })} />
                    </td>
                  )}
                  <td className="pt-1.5">
                    {!isEmpty(l) && (
                      <button
                        type="button"
                        className="rounded-sm p-1.5 text-text-muted hover:bg-row-hover hover:text-danger"
                        aria-label={`Delete line ${idx + 1}`}
                        onClick={() => setLines((ls) => withSpare(ls.filter((x) => x.key !== l.key)))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
              Add line
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLines(withSpare([]))}>
              Clear all lines
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-4">
            <Field label={`Message on ${K.noun}`}>{(p) => <Textarea {...p} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Thank you for your business." />}</Field>
            <Field label="Note to self" hint="Only you see this.">
              {(p) => <Textarea {...p} value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} />}
            </Field>
            {initial && isInvoice && initial.status === "posted" && (
              <ApplyCredits companyId={companyId} docId={initial.id} contactId={initial.contact_id} side="ar" openCents={initial.balance_cents} />
            )}
            {initial && <Attachments companyId={companyId} txnId={initial.id} />}
          </div>
          <dl className="flex flex-col gap-2 self-start">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="num">{formatCents(totals.subtotalCents)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>Discount</dt>
              <dd className="w-36">
                <MoneyInput aria-label="Discount amount" value={discount} onValueChange={setDiscount} placeholder="0.00" />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>
                <NativeSelect
                  aria-label="Sales tax rate"
                  value={taxRateId}
                  disabled={!!customers.find((c) => c.id === contactId)?.tax_exempt}
                  title={customers.find((c) => c.id === contactId)?.tax_exempt ? "This customer is tax exempt" : undefined}
                  onChange={(e) => setTaxRateId(e.target.value)}
                  className="w-48"
                >
                  <option value="">No sales tax</option>
                  {props.taxRates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({(t.rate_bp / 100).toFixed(2)}%)
                    </option>
                  ))}
                </NativeSelect>
              </dt>
              <dd className="num">{formatCents(totals.taxCents)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-md font-semibold">
              <dt>Total</dt>
              <dd className="num">{formatCents(totals.totalCents)}</dd>
            </div>
            {isInvoice && paid > 0 && (
              <div className="flex justify-between text-text-muted">
                <dt>Payments received</dt>
                <dd className="num">{formatCents(-paid)}</dd>
              </div>
            )}
            {isInvoice && (
              <div className="flex justify-between font-semibold">
                <dt>Balance due</dt>
                <dd className="num">{formatCents(balanceDue)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="sticky bottom-0 flex h-[var(--form-action-bar-height)] items-center justify-between gap-2 border-t border-border bg-bg px-6">
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/c/${companyId}/sales`}>Cancel</Link>
          </Button>
          {initial && (
            <TxnMoreMenu
              companyId={companyId}
              txnId={initial.id}
              label={K.noun}
              voided={initial.status === "voided"}
              afterDelete={`/c/${companyId}/sales`}
              recur={{ txnType: kind, txnDate: initial.txn_date, name: `${customers.find((c) => c.id === initial.contact_id)?.display_name ?? "Customer"} ${K.noun}` }}
              extra={[
                { label: "Print or download PDF", onSelect: () => window.open(`${base}/${initial.id}/pdf`, "_blank") },
                ...(isInvoice && initial.status !== "voided" ? [{ label: "Email invoice", onSelect: () => setEmailOpen(true) }] : []),
              ]}
            />
          )}
          {isEstimate && initial && initial.status === "posted" && initial.doc_status !== "rejected" && initial.doc_status !== "closed" && (
            <Button asChild variant="ghost">
              <Link href={`/c/${companyId}/invoices/new?fromEstimate=${initial.id}`}>Create invoice</Link>
            </Button>
          )}
          {isInvoice && initial && initial.balance_cents > 0 && (
            <Button asChild variant="ghost">
              <Link href={`/c/${companyId}/payments/new?customer=${initial.contact_id}&invoice=${initial.id}`}>Receive payment</Link>
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => save("new")} disabled={pending || initial?.status === "voided"}>
            Save and new
          </Button>
          <Button id="invoice-save" variant="primary" loading={pending} disabled={initial?.status === "voided"} onClick={() => save("stay")}>
            Save
          </Button>
        </div>
      </div>

      {initial && isInvoice && (
        <EmailInvoiceDialog
          companyId={companyId}
          invoiceId={initial.id}
          number={initial.number}
          defaultTo={email}
          open={emailOpen}
          onOpenChange={setEmailOpen}
        />
      )}
      <CustomerDrawer
        companyId={companyId}
        open={customerDrawer != null}
        onOpenChange={(o) => !o && setCustomerDrawer(null)}
        initial={{ displayName: customerDrawer ?? "" }}
        terms={props.terms}
        taxRates={props.taxRates}
        onSaved={(c) => {
          setCustomers((cs) => [...cs, { id: c.id, display_name: c.displayName, email: c.email, terms_id: c.termsId, tax_exempt: false, default_tax_rate_id: null, parent_id: null }]);
          setContactId(c.id);
          if (c.email) setEmail(c.email);
          if (c.termsId) {
            setTermsId(c.termsId);
            applyTerms(c.termsId);
          }
        }}
      />
      <ItemDrawer
        companyId={companyId}
        open={itemDrawer != null}
        onOpenChange={(o) => !o && setItemDrawer(null)}
        initial={{ name: itemDrawer?.name ?? "" }}
        incomeAccounts={props.incomeAccounts}
        onSaved={(it: SavedItem) => {
          const opt = { id: it.id, name: it.name, description: it.description, sales_price_cents: it.salesPriceCents, taxable: it.taxable };
          const next = [...items, opt];
          setItems(next);
          if (itemDrawer) pickItem(itemDrawer.lineKey, it.id, next);
        }}
      />
    </div>
  );
}
