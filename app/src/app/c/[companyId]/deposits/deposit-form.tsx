"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CategoryLines, isBlankCategory, withSpareCategories, type CategoryLine } from "@/components/category-lines";
import { FormShell } from "@/components/form-shell";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import type { AccountType } from "@/lib/coa";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TXN_LABEL } from "@/lib/routes";
import { saveTransactionAction } from "../actions";

export interface Undeposited {
  id: string;
  type: string;
  txn_date: string;
  customer: string | null;
  payment_method: string | null;
  number: string | null;
  total_cents: number;
}

export interface DepositDetail {
  id: string;
  txn_date: string;
  account_id: string;
  memo: string | null;
  status: string;
  updated_at: string;
  source_ids: string[];
  lines: { account_id: string; description: string | null; amount_cents: number }[];
}

export function DepositForm({
  companyId,
  today,
  banks,
  categories,
  payments,
  initial,
}: {
  companyId: string;
  today: string;
  banks: { id: string; name: string }[];
  categories: { id: string; name: string; type: AccountType }[];
  payments: Undeposited[];
  initial: DepositDetail | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closePassword, setClosePassword] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(initial?.account_id ?? banks[0]?.id ?? "");
  const [date, setDate] = useState(initial?.txn_date ?? today);
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.source_ids ?? []));
  const [lines, setLines] = useState<CategoryLine[]>(() =>
    withSpareCategories((initial?.lines ?? []).map((l, i) => ({ key: 5000 + i, accountId: l.account_id, description: l.description ?? "", amountCents: l.amount_cents }))),
  );
  const voided = initial?.status === "voided";
  const fromPayments = payments.filter((p) => selected.has(p.id)).reduce((s, p) => s + p.total_cents, 0);
  const other = lines.filter((l) => !isBlankCategory(l));
  const total = fromPayments + other.reduce((s, l) => s + (l.amountCents ?? 0), 0);

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  function save() {
    setError(null);
    if (selected.size === 0 && other.length === 0) return setError("Pick payments to deposit or add a line.");
    const bad = other.findIndex((l) => !l.accountId);
    if (bad >= 0) return setError(`Line ${bad + 1}: choose an account.`);
    start(async () => {
      const res = await saveTransactionAction(
        companyId,
        {
          type: "deposit",
          id: initial?.id,
          ifUpdatedAt: initial?.updated_at,
          txnDate: date,
          accountId,
          memo: memo || null,
          depositSourceIds: [...selected],
          lines: other.map((l) => ({ accountId: l.accountId, description: l.description || null, amountCents: l.amountCents ?? 0 })),
        },
        closePassword ?? undefined,
      );
      if (!res.ok) {
        if (res.error.includes("closed period") && closePassword == null) setClosePassword("");
        return setError(res.error);
      }
      router.replace(`/c/${companyId}/deposits/${res.data.id}?saved=1`);
      router.refresh();
    });
  }

  return (
    <FormShell
      title={initial ? "Bank deposit" : "New bank deposit"}
      status={voided ? <StatusPill tone="voided">Voided</StatusPill> : undefined}
      closeHref={`/c/${companyId}/sales`}
      error={error}
      closePassword={closePassword}
      onClosePassword={setClosePassword}
      saveId="deposit-save"
      left={
        <>
          <Button asChild>
            <Link href={`/c/${companyId}/sales`}>Cancel</Link>
          </Button>
          {initial && <TxnMoreMenu companyId={companyId} txnId={initial.id} label="deposit" voided={voided} afterDelete={`/c/${companyId}/sales`} />}
        </>
      }
      right={
        <Button id="deposit-save" variant="primary" loading={pending} disabled={voided} onClick={save}>
          Save
        </Button>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:max-w-2xl">
          <Field label="Deposit to">
            {(p) => (
              <NativeSelect {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <div className="min-w-48 text-right">
          <p className="text-sm font-medium tracking-wide text-text-muted uppercase">Deposit total</p>
          <p className="num text-display font-bold">{formatCents(total)}</p>
        </div>
      </div>

      <h2 className="mt-8 mb-2 text-md font-semibold">Payments to deposit</h2>
      {payments.length === 0 ? (
        <p className="text-text-muted">Nothing is waiting in Undeposited Funds.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-text-muted uppercase">
              <th className="w-10 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all payments"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={payments.every((p) => selected.has(p.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(payments.map((p) => p.id)) : new Set())}
                />
              </th>
              <th className="py-2">Received from</th>
              <th className="py-2">Date</th>
              <th className="py-2">Type</th>
              <th className="py-2">Method</th>
              <th className="py-2">Ref no.</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border">
                <td className="py-2">
                  <input
                    type="checkbox"
                    aria-label={`Deposit ${TXN_LABEL[p.type].toLowerCase()} from ${p.customer} ${formatCents(p.total_cents)}`}
                    className="size-4 accent-[var(--color-accent)]"
                    checked={selected.has(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />
                </td>
                <td className="py-2">{p.customer}</td>
                <td className="py-2">{formatDate(p.txn_date)}</td>
                <td className="py-2">{TXN_LABEL[p.type]}</td>
                <td className="py-2">{p.payment_method}</td>
                <td className="py-2">{p.number}</td>
                <td className="num py-2">{formatCents(p.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-8">
        <CategoryLines lines={lines} onChange={setLines} accounts={categories} label="Add funds to this deposit" />
        <p className="mt-2 text-sm text-text-muted">Use a negative amount for a fee or cash back.</p>
      </div>
      <Field label="Memo" className="mt-6 max-w-2xl">
        {(p) => <Textarea {...p} value={memo} onChange={(e) => setMemo(e.target.value)} />}
      </Field>
    </FormShell>
  );
}
