"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, MoneyInput, NativeSelect, Textarea } from "@/components/ui/field";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { openInvoicesAction, saveTransactionAction } from "../actions";

interface OpenInvoice {
  id: string;
  number: string | null;
  txn_date: string;
  due_date: string | null;
  total_cents: number;
  balance_cents: number;
}

export interface PaymentDetail {
  id: string;
  contact_id: string;
  txn_date: string;
  account_id: string;
  payment_method: string | null;
  number: string | null;
  total_cents: number;
  memo: string | null;
  status: string;
  updated_at: string;
  applications: { txn_id: string; amount_cents: number }[];
}

interface Props {
  initial?: PaymentDetail | null;
  companyId: string;
  today: string;
  customers: { id: string; display_name: string }[];
  depositAccounts: { id: string; name: string; system_role: string | null }[];
  presetCustomerId?: string;
  presetInvoiceId?: string;
}

const METHODS = ["Check", "ACH / bank transfer", "Credit card", "Cash", "Other"];

/** Apply `amount` to invoices oldest-due first. */
function autoApply(invoices: OpenInvoice[], amount: number) {
  const out: Record<string, number> = {};
  let left = amount;
  for (const inv of invoices) {
    if (left <= 0) break;
    const a = Math.min(left, inv.balance_cents);
    out[inv.id] = a;
    left -= a;
  }
  return out;
}

export function PaymentForm(props: Props) {
  const { companyId } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const undeposited = props.depositAccounts.find((a) => a.system_role === "undeposited_funds")?.id ?? "";
  const initial = props.initial ?? null;
  const [contactId, setContactId] = useState<string | null>(initial?.contact_id ?? props.presetCustomerId ?? null);
  const [txnDate, setTxnDate] = useState(initial?.txn_date ?? props.today);
  const [method, setMethod] = useState(initial?.payment_method ?? "Check");
  const [ref, setRef] = useState(initial?.number ?? "");
  const [depositTo, setDepositTo] = useState(initial?.account_id ?? undeposited);
  const [amount, setAmount] = useState<number | null>(initial?.total_cents ?? null);
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null);
  const [applied, setApplied] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!contactId) {
      setInvoices(null);
      return;
    }
    let cancelled = false;
    openInvoicesAction(companyId, contactId, initial?.id).then((rows) => {
      if (cancelled) return;
      setInvoices(rows);
      if (initial && contactId === initial.contact_id) {
        setApplied(Object.fromEntries(initial.applications.map((a) => [a.txn_id, a.amount_cents])));
        return;
      }
      // Coming from an invoice: pay that one in full
      const preset = rows.find((r) => r.id === props.presetInvoiceId);
      if (preset) {
        setApplied({ [preset.id]: preset.balance_cents });
        setAmount(preset.balance_cents);
      } else {
        setApplied({});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, contactId, props.presetInvoiceId, initial]);

  const appliedTotal = Object.values(applied).reduce((a, b) => a + b, 0);
  const received = amount ?? 0;
  const credit = received - appliedTotal;

  function save(then: "close" | "new") {
    setError(null);
    if (!contactId) return setError("Choose a customer.");
    if (!received) return setError("Enter the amount received.");
    if (credit < 0) return setError("You applied more than the amount received. Lower an amount or raise the amount received.");
    start(async () => {
      const res = await saveTransactionAction(companyId, {
        type: "payment",
        id: initial?.id,
        ifUpdatedAt: initial?.updated_at,
        contactId,
        txnDate,
        depositToId: depositTo || null,
        paymentMethod: method,
        number: ref || null,
        amountCents: received,
        applications: Object.entries(applied)
          .filter(([, v]) => v > 0)
          .map(([txnId, amountCents]) => ({ txnId, amountCents })),
        memo: memo || null,
      });
      if (!res.ok) return setError(res.error);
      router.push(then === "new" ? `/c/${companyId}/payments/new?saved=1` : `/c/${companyId}/sales`);
      router.refresh();
    });
  }

  return (
    <div className="-m-6 flex min-h-[calc(100dvh-var(--header-height))] flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold">{initial ? "Payment" : "Receive payment"}</h1>
        <Link href={`/c/${companyId}/sales`} className="rounded-sm p-1 text-text-muted hover:bg-row-hover" aria-label="Close">
          <X className="size-5" />
        </Link>
      </div>
      <div className="flex-1 px-6 py-6">
        {error && (
          <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Customer" required>
              {(p) => (
                <Combobox
                  {...p}
                  options={props.customers.map((c) => ({ value: c.id, label: c.display_name }))}
                  value={contactId}
                  onChange={setContactId}
                  placeholder="Choose a customer"
                />
              )}
            </Field>
            <Field label="Payment date">{(p) => <Input {...p} type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />}</Field>
            <Field label="Payment method">
              {(p) => (
                <NativeSelect {...p} value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Reference no." hint="Check number or transfer ID">
              {(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={21} />}
            </Field>
            <Field label="Deposit to" hint={depositTo === undeposited ? "Group it with other payments in a bank deposit later." : undefined}>
              {(p) => (
                <NativeSelect {...p} value={depositTo} onChange={(e) => setDepositTo(e.target.value)}>
                  {props.depositAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Amount received" required>
              {(p) => (
                <MoneyInput
                  {...p}
                  value={amount}
                  onValueChange={(v) => {
                    setAmount(v);
                    if (invoices) setApplied(autoApply(invoices, v ?? 0));
                  }}
                />
              )}
            </Field>
          </div>
          <div className="min-w-48 text-right">
            <p className="text-sm font-medium tracking-wide text-text-muted uppercase">Amount received</p>
            <p className="num text-display font-bold">{formatCents(received)}</p>
          </div>
        </div>

        <h2 className="mt-8 mb-2 text-md font-semibold">Outstanding invoices</h2>
        {!contactId ? (
          <p className="text-text-muted">Choose a customer to see their open invoices.</p>
        ) : invoices == null ? (
          <p className="text-text-muted">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="text-text-muted">This customer has no open invoices. Anything received is kept as a credit.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-text-muted uppercase">
                <th className="w-10 py-2">
                  <input
                    type="checkbox"
                    aria-label="Pay all invoices"
                    className="size-4 accent-[var(--color-accent)]"
                    checked={invoices.every((i) => applied[i.id] === i.balance_cents)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const all = Object.fromEntries(invoices.map((i) => [i.id, i.balance_cents]));
                        setApplied(all);
                        const sum = invoices.reduce((s, i) => s + i.balance_cents, 0);
                        if ((amount ?? 0) < sum) setAmount(sum);
                      } else setApplied({});
                    }}
                  />
                </th>
                <th className="py-2">Invoice</th>
                <th className="py-2">Due date</th>
                <th className="py-2 text-right">Original amount</th>
                <th className="py-2 text-right">Open balance</th>
                <th className="w-40 py-2 text-right">Payment</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      aria-label={`Pay invoice ${inv.number}`}
                      className="size-4 accent-[var(--color-accent)]"
                      checked={(applied[inv.id] ?? 0) > 0}
                      onChange={(e) => {
                        const next = { ...applied, [inv.id]: e.target.checked ? inv.balance_cents : 0 };
                        setApplied(next);
                        const sum = Object.values(next).reduce((a, b) => a + b, 0);
                        if ((amount ?? 0) < sum) setAmount(sum);
                      }}
                    />
                  </td>
                  <td className="py-2">
                    Invoice {inv.number} <span className="text-text-muted">({formatDate(inv.txn_date)})</span>
                  </td>
                  <td className="py-2">{inv.due_date ? formatDate(inv.due_date) : ""}</td>
                  <td className="num py-2">{formatCents(inv.total_cents)}</td>
                  <td className="num py-2">{formatCents(inv.balance_cents)}</td>
                  <td className="py-1.5 pl-4">
                    <MoneyInput
                      aria-label={`Payment for invoice ${inv.number}`}
                      value={applied[inv.id] || null}
                      onValueChange={(v) => setApplied({ ...applied, [inv.id]: Math.min(v ?? 0, inv.balance_cents) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <Field label="Memo">{(p) => <Textarea {...p} value={memo} onChange={(e) => setMemo(e.target.value)} />}</Field>
          <dl className="flex flex-col gap-2 self-start">
            <div className="flex justify-between">
              <dt>Amount to apply</dt>
              <dd className="num">{formatCents(appliedTotal)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{credit >= 0 ? "Amount to credit" : "Over-applied"}</dt>
              <dd className={credit < 0 ? "num text-danger" : "num"}>{formatCents(credit)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="sticky bottom-0 flex h-[var(--form-action-bar-height)] items-center justify-between gap-2 border-t border-border bg-bg px-6">
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/c/${companyId}/sales`}>Cancel</Link>
          </Button>
          {initial && (
            <TxnMoreMenu companyId={companyId} txnId={initial.id} label="payment" voided={initial.status === "voided"} afterDelete={`/c/${companyId}/sales`} />
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => save("new")} disabled={pending}>
            Save and new
          </Button>
          <Button variant="primary" loading={pending} onClick={() => save("close")}>
            Save and close
          </Button>
        </div>
      </div>
    </div>
  );
}
