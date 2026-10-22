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
import { saveTransactionAction } from "../actions";
import { CustomerDrawer } from "../customers/customer-drawer";
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
interface Props {
  companyId: string;
  today: string;
  customers: { id: string; display_name: string; email: string | null; terms_id: string | null }[];
  items: ItemOption[];
  terms: { id: string; name: string; due_days: number | null }[];
  taxRates: { id: string; name: string; rate_bp: number }[];
  incomeAccounts: Option[];
  initial: InvoiceDetail | null;
  presetCustomerId?: string;
}

interface Line {
  key: number;
  itemId: string | null;
  description: string;
  qty: number | null;
  rateCents: number | null;
  amountCents: number | null;
  taxable: boolean;
}

let keySeq = 0;
const blank = (): Line => ({ key: ++keySeq, itemId: null, description: "", qty: null, rateCents: null, amountCents: null, taxable: false });

function isEmpty(l: Line) {
  return !l.itemId && !l.description && !l.amountCents;
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

export function InvoiceForm(props: Props) {
  const { companyId, today, initial } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState(props.customers);
  const [items, setItems] = useState(props.items);
  const [customerDrawer, setCustomerDrawer] = useState<string | null>(null);
  const [itemDrawer, setItemDrawer] = useState<{ name: string; lineKey: number } | null>(null);

  const defaultTerms = props.terms.find((t) => t.name === "Net 30")?.id ?? props.terms[0]?.id ?? null;
  const [contactId, setContactId] = useState<string | null>(initial?.contact_id ?? props.presetCustomerId ?? null);
  const [email, setEmail] = useState(initial?.email_to?.[0] ?? customers.find((c) => c.id === props.presetCustomerId)?.email ?? "");
  const [txnDate, setTxnDate] = useState(initial?.txn_date ?? today);
  const [termsId, setTermsId] = useState<string | null>(initial ? initial.terms_id : defaultTerms);
  const [dueDate, setDueDate] = useState(initial?.due_date ?? addDays(today, props.terms.find((t) => t.id === defaultTerms)?.due_days ?? 30));
  const [number, setNumber] = useState(initial?.number ?? "");
  const [discount, setDiscount] = useState<number | null>(initial?.discount_cents || null);
  const [taxRateId, setTaxRateId] = useState<string>(initial?.tax_rate_id ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [privateNote, setPrivateNote] = useState(initial?.private_note ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    withSpare(
      (initial?.lines ?? []).map((l) => ({
        key: ++keySeq,
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
      if (c.email) setEmail(c.email);
      if (c.terms_id) {
        setTermsId(c.terms_id);
        applyTerms(c.terms_id);
      }
    }
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
    const bad = filled.find((l) => !l.itemId);
    if (bad) return setError(`Line ${filled.indexOf(bad) + 1}: choose a product or service.`);
    const payload = {
      type: "invoice" as const,
      id: initial?.id,
      ifUpdatedAt: initial?.updated_at,
      contactId,
      txnDate,
      dueDate,
      termsId,
      number: number.trim() || null,
      lines: filled.map((l) => ({
        itemId: l.itemId,
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
      const res = await saveTransactionAction(companyId, payload);
      if (!res.ok) return setError(res.error);
      if (then === "new") {
        router.push(`/c/${companyId}/invoices/new?saved=${res.data.number}`);
        router.refresh();
      } else if (then === "close") router.push(`/c/${companyId}/invoices`);
      else {
        router.replace(`/c/${companyId}/invoices/${res.data.id}?saved=1`);
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
    ) : initial && initial.balance_cents === 0 ? (
      <StatusPill tone="paid">Paid</StatusPill>
    ) : initial && paid > 0 ? (
      <StatusPill tone="partial">Partially paid</StatusPill>
    ) : null;

  return (
    <div className="-m-6 flex min-h-[calc(100dvh-var(--header-height))] flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{initial ? `Invoice ${initial.number ?? ""}` : "New invoice"}</h1>
          {status}
        </div>
        <Link href={`/c/${companyId}/invoices`} className="rounded-sm p-1 text-text-muted hover:bg-row-hover" aria-label="Close">
          <X className="size-5" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
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
            <Field label="Invoice date">
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
            <Field label="Due date">{(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
            <Field label="Invoice no." hint={initial ? undefined : "Leave blank for the next number"}>
              {(p) => <Input {...p} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={21} />}
            </Field>
          </div>
          <div className="min-w-48 text-right">
            <p className="text-sm font-medium tracking-wide text-text-muted uppercase">Balance due</p>
            <p className="num text-display font-bold">{formatCents(balanceDue)}</p>
          </div>
        </div>

        {/* Line grid */}
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse" aria-label="Invoice lines">
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
                    <Combobox
                      aria-label={`Line ${idx + 1} product or service`}
                      options={itemOptions}
                      value={l.itemId}
                      onChange={(v) => pickItem(l.key, v)}
                      placeholder="Choose"
                      onAddNew={(typed) => setItemDrawer({ name: typed, lineKey: l.key })}
                      addNewLabel="Add new"
                    />
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
            <Field label="Message on invoice">{(p) => <Textarea {...p} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Thank you for your business." />}</Field>
            <Field label="Note to self" hint="Only you see this.">
              {(p) => <Textarea {...p} value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} />}
            </Field>
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
                <NativeSelect aria-label="Sales tax rate" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)} className="w-48">
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
            {paid > 0 && (
              <div className="flex justify-between text-text-muted">
                <dt>Payments received</dt>
                <dd className="num">{formatCents(-paid)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <dt>Balance due</dt>
              <dd className="num">{formatCents(balanceDue)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="sticky bottom-0 flex h-[var(--form-action-bar-height)] items-center justify-between gap-2 border-t border-border bg-bg px-6">
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/c/${companyId}/invoices`}>Cancel</Link>
          </Button>
          {initial && initial.balance_cents > 0 && (
            <Button asChild variant="ghost">
              <Link href={`/c/${companyId}/payments/new?customer=${initial.contact_id}&invoice=${initial.id}`}>Receive payment</Link>
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => save("new")} disabled={pending}>
            Save and new
          </Button>
          <Button id="invoice-save" variant="primary" loading={pending} onClick={() => save("stay")}>
            Save
          </Button>
        </div>
      </div>

      <CustomerDrawer
        companyId={companyId}
        open={customerDrawer != null}
        onOpenChange={(o) => !o && setCustomerDrawer(null)}
        initial={{ displayName: customerDrawer ?? "" }}
        terms={props.terms}
        onSaved={(c) => {
          setCustomers((cs) => [...cs, { id: c.id, display_name: c.displayName, email: c.email, terms_id: c.termsId }]);
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
