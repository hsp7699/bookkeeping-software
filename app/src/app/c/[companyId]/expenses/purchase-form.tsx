"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CategoryLines, isBlankCategory, withSpareCategories, type CategoryLine } from "@/components/category-lines";
import { CustomerDrawer } from "@/components/contact-drawer";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import type { AccountType } from "@/lib/coa";
import { addDays } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { PurchaseDetail } from "@/lib/queries";
import { saveTransactionAction } from "../actions";
import { Attachments } from "@/components/attachments";

export type PurchaseKind = "expense" | "check" | "bill" | "vendor_credit" | "credit_card_credit";

const KIND: Record<PurchaseKind, { title: string; noun: string; path: string; payee: string; vendorOnly: boolean; money: string | null; numberLabel: string; dateLabel: string }> = {
  expense: { title: "Expense", noun: "expense", path: "expenses", payee: "Payee", vendorOnly: false, money: "Payment account", numberLabel: "Ref no.", dateLabel: "Payment date" },
  check: { title: "Check", noun: "check", path: "checks", payee: "Payee", vendorOnly: false, money: "Bank account", numberLabel: "Check no.", dateLabel: "Payment date" },
  bill: { title: "Bill", noun: "bill", path: "bills", payee: "Vendor", vendorOnly: true, money: null, numberLabel: "Bill no.", dateLabel: "Bill date" },
  vendor_credit: { title: "Vendor credit", noun: "vendor credit", path: "vendor-credits", payee: "Vendor", vendorOnly: true, money: null, numberLabel: "Ref no.", dateLabel: "Credit date" },
  credit_card_credit: { title: "Credit card credit", noun: "credit card credit", path: "card-credits", payee: "Payee", vendorOnly: false, money: "Credit card", numberLabel: "Ref no.", dateLabel: "Date" },
};

const METHODS = ["Credit card", "Debit card", "ACH / bank transfer", "Check", "Cash", "Other"];

interface Props {
  kind: PurchaseKind;
  companyId: string;
  today: string;
  contacts: { id: string; display_name: string; kind: string; terms_id: string | null; default_account_id: string | null }[];
  moneyAccounts: { id: string; name: string; type: AccountType }[];
  categories: { id: string; name: string; type: AccountType }[];
  terms: { id: string; name: string; due_days: number | null }[];
  initial: PurchaseDetail | null;
  presetVendorId?: string;
}

export function PurchaseForm(props: Props) {
  const { kind, companyId, today, initial } = props;
  const K = KIND[kind];
  const isBill = kind === "bill";
  const base = `/c/${companyId}/${K.path}`;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState(props.contacts);
  const [newPayee, setNewPayee] = useState<string | null>(null);
  const [closePassword, setClosePassword] = useState<string | null>(null);

  const defaultTerms = props.terms.find((t) => t.name === "Net 30")?.id ?? null;
  const [contactId, setContactId] = useState<string | null>(initial?.contact_id ?? props.presetVendorId ?? null);
  const [accountId, setAccountId] = useState(initial?.account_id ?? props.moneyAccounts[0]?.id ?? "");
  const [txnDate, setTxnDate] = useState(initial?.txn_date ?? today);
  const [termsId, setTermsId] = useState<string | null>(initial ? initial.terms_id : defaultTerms);
  const [dueDate, setDueDate] = useState(initial?.due_date ?? addDays(today, 30));
  const [number, setNumber] = useState(initial?.number ?? "");
  const [method, setMethod] = useState(initial?.payment_method ?? "Credit card");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [lines, setLines] = useState<CategoryLine[]>(() =>
    withSpareCategories(
      (initial?.lines ?? []).map((l, i) => ({ key: 100000 + i, accountId: l.account_id, description: l.description ?? "", amountCents: l.amount_cents })),
    ),
  );

  const filled = lines.filter((l) => !isBlankCategory(l));
  const total = filled.reduce((s, l) => s + (l.amountCents ?? 0), 0);
  const paid = initial && isBill ? initial.total_cents - initial.balance_cents : 0;

  function applyTerms(tid: string | null, date = txnDate) {
    const t = props.terms.find((x) => x.id === tid);
    if (t?.due_days != null) setDueDate(addDays(date, t.due_days));
  }

  function pickPayee(id: string | null) {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    if (isBill && c.terms_id) {
      setTermsId(c.terms_id);
      applyTerms(c.terms_id);
    }
    // Pre-fill the first line with the vendor's usual category
    if (c.default_account_id && filled.length === 0) {
      setLines(withSpareCategories([{ key: 99999, accountId: c.default_account_id, description: "", amountCents: null }]));
    }
  }

  function save(then: "stay" | "new") {
    setError(null);
    if (K.vendorOnly && !contactId) return setError("Choose a vendor.");
    if (filled.length === 0) return setError("Add at least one line.");
    const bad = filled.findIndex((l) => !l.accountId);
    if (bad >= 0) return setError(`Line ${bad + 1}: choose a category.`);
    start(async () => {
      const res = await saveTransactionAction(
        companyId,
        {
          type: kind,
          id: initial?.id,
          ifUpdatedAt: initial?.updated_at,
          contactId,
          accountId: K.money ? accountId : null,
          txnDate,
          dueDate: isBill ? dueDate : null,
          termsId: isBill ? termsId : null,
          number: number.trim() || null,
          paymentMethod: kind === "expense" ? method : null,
          memo: memo || null,
          lines: filled.map((l) => ({ accountId: l.accountId, description: l.description || null, amountCents: l.amountCents ?? 0 })),
        },
        closePassword ?? undefined,
      );
      if (!res.ok) {
        if (res.error.includes("closed period") && closePassword == null) setClosePassword("");
        return setError(res.error);
      }
      if (then === "new") router.push(`${base}/new?saved=1`);
      else router.replace(`${base}/${res.data.id}?saved=1`);
      router.refresh();
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        document.getElementById("purchase-save")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const payeeOptions = contacts
    .filter((c) => !K.vendorOnly || c.kind === "vendor")
    .map((c) => ({ value: c.id, label: c.display_name, hint: K.vendorOnly ? undefined : c.kind.charAt(0).toUpperCase() + c.kind.slice(1) }));
  const voided = initial?.status === "voided";

  return (
    <div className="-m-6 flex min-h-[calc(100dvh-var(--header-height))] flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{initial ? `${K.title}${initial.number ? ` ${initial.number}` : ""}` : `New ${K.noun}`}</h1>
          {voided && <StatusPill tone="voided">Voided</StatusPill>}
          {!voided && isBill && initial && (initial.balance_cents === 0 ? <StatusPill tone="paid">Paid</StatusPill> : paid > 0 ? <StatusPill tone="partial">Partially paid</StatusPill> : <StatusPill tone="open">Open</StatusPill>)}
        </div>
        <Link href={`/c/${companyId}/expenses`} className="rounded-sm p-1 text-text-muted hover:bg-row-hover" aria-label="Close">
          <X className="size-5" />
        </Link>
      </div>

      <div className="flex-1 px-6 py-6">
        {error && (
          <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        {closePassword != null && (
          <Field label="Close-books password" className="mb-4 max-w-sm">
            {(p) => <Input {...p} type="password" value={closePassword} onChange={(e) => setClosePassword(e.target.value)} />}
          </Field>
        )}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={K.payee} required={K.vendorOnly}>
              {(p) => (
                <Combobox
                  {...p}
                  options={payeeOptions}
                  value={contactId}
                  onChange={pickPayee}
                  placeholder={K.vendorOnly ? "Choose a vendor" : "Who did you pay?"}
                  onAddNew={(typed) => setNewPayee(typed)}
                  addNewLabel="Add new vendor"
                />
              )}
            </Field>
            {K.money && (
              <Field label={K.money}>
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
            )}
            {isBill && (
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
            <Field label={K.dateLabel}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={txnDate}
                  onChange={(e) => {
                    setTxnDate(e.target.value);
                    if (isBill) applyTerms(termsId, e.target.value);
                  }}
                />
              )}
            </Field>
            {isBill && <Field label="Due date">{(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>}
            {kind === "expense" && (
              <Field label="Payment method">
                {(p) => (
                  <NativeSelect {...p} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            )}
            <Field label={K.numberLabel}>{(p) => <Input {...p} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={21} />}</Field>
          </div>
          <div className="min-w-48 text-right">
            <p className="text-sm font-medium tracking-wide text-text-muted uppercase">{isBill && initial ? "Balance due" : "Total"}</p>
            <p className="num text-display font-bold">{formatCents(isBill && initial ? total - paid : total)}</p>
          </div>
        </div>

        <div className="mt-8">
          <CategoryLines lines={lines} onChange={setLines} accounts={props.categories} />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-4">
            <Field label="Memo">{(p) => <Textarea {...p} value={memo} onChange={(e) => setMemo(e.target.value)} />}</Field>
            {initial && <Attachments companyId={companyId} txnId={initial.id} />}
          </div>
          <dl className="flex flex-col gap-2 self-start">
            <div className="flex justify-between text-md font-semibold">
              <dt>Total</dt>
              <dd className="num">{formatCents(total)}</dd>
            </div>
            {paid > 0 && (
              <div className="flex justify-between text-text-muted">
                <dt>Payments made</dt>
                <dd className="num">{formatCents(-paid)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="sticky bottom-0 flex h-[var(--form-action-bar-height)] items-center justify-between gap-2 border-t border-border bg-bg px-6">
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/c/${companyId}/expenses`}>Cancel</Link>
          </Button>
          {initial && <TxnMoreMenu companyId={companyId} txnId={initial.id} label={K.noun} voided={voided} afterDelete={`/c/${companyId}/expenses`} />}
          {isBill && initial && initial.balance_cents > 0 && !voided && (
            <Button asChild variant="ghost">
              <Link href={`/c/${companyId}/bills/pay?vendor=${initial.contact_id}`}>Pay bill</Link>
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => save("new")} disabled={pending || voided}>
            Save and new
          </Button>
          <Button id="purchase-save" variant="primary" loading={pending} disabled={voided} onClick={() => save("stay")}>
            Save
          </Button>
        </div>
      </div>

      <CustomerDrawer
        kind="vendor"
        companyId={companyId}
        open={newPayee != null}
        onOpenChange={(o) => !o && setNewPayee(null)}
        initial={{ displayName: newPayee ?? "" }}
        terms={props.terms}
        onSaved={(c) => {
          setContacts((cs) => [...cs, { id: c.id, display_name: c.displayName, kind: "vendor", terms_id: c.termsId, default_account_id: null }]);
          setContactId(c.id);
        }}
      />
    </div>
  );
}
