"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormShell } from "@/components/form-shell";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, NativeSelect, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/coa";
import { formatCents } from "@/lib/money";
import { saveTransactionAction } from "../actions";

export interface TransferDetail {
  id: string;
  txn_date: string;
  account_id: string; // to
  from_account_id: string;
  total_cents: number;
  memo: string | null;
  status: string;
  updated_at: string;
}

export function TransferForm({
  companyId,
  today,
  accounts,
  initial,
}: {
  companyId: string;
  today: string;
  accounts: { id: string; name: string; type: AccountType }[];
  initial: TransferDetail | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closePassword, setClosePassword] = useState<string | null>(null);
  const banks = accounts.filter((a) => a.type === "bank");
  const [from, setFrom] = useState(initial?.from_account_id ?? banks[0]?.id ?? "");
  const [to, setTo] = useState(initial?.account_id ?? banks[1]?.id ?? accounts.find((a) => a.id !== from)?.id ?? "");
  const [amount, setAmount] = useState<number | null>(initial?.total_cents ?? null);
  const [date, setDate] = useState(initial?.txn_date ?? today);
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const voided = initial?.status === "voided";

  function save() {
    setError(null);
    if (!amount) return setError("Enter the amount to transfer.");
    if (from === to) return setError("Choose two different accounts.");
    start(async () => {
      const res = await saveTransactionAction(
        companyId,
        { type: "transfer", id: initial?.id, ifUpdatedAt: initial?.updated_at, txnDate: date, accountId: to, fromAccountId: from, amountCents: amount, memo: memo || null },
        closePassword ?? undefined,
      );
      if (!res.ok) {
        if (res.error.includes("closed period") && closePassword == null) setClosePassword("");
        return setError(res.error);
      }
      router.replace(`/c/${companyId}/transfers/${res.data.id}?saved=1`);
      router.refresh();
    });
  }

  const select = (value: string, onChange: (v: string) => void) =>
    function AccountSelect(p: object) {
      return (
    <NativeSelect {...p} value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(Object.groupBy(accounts, (a) => a.type)).map(([type, list]) => (
        <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type as AccountType]}>
          {list!.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
      );
    };

  return (
    <FormShell
      title={initial ? "Transfer" : "New transfer"}
      status={voided ? <StatusPill tone="voided">Voided</StatusPill> : undefined}
      closeHref={`/c/${companyId}/accounts`}
      error={error}
      closePassword={closePassword}
      onClosePassword={setClosePassword}
      saveId="transfer-save"
      left={
        <>
          <Button asChild>
            <Link href={`/c/${companyId}/accounts`}>Cancel</Link>
          </Button>
          {initial && <TxnMoreMenu companyId={companyId} txnId={initial.id} label="transfer" voided={voided} afterDelete={`/c/${companyId}/accounts`} />}
        </>
      }
      right={
        <Button id="transfer-save" variant="primary" loading={pending} disabled={voided} onClick={save}>
          Save
        </Button>
      }
    >
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <Field label="Transfer funds from">{select(from, setFrom)}</Field>
        <Field label="Transfer funds to">{select(to, setTo)}</Field>
        <Field label="Transfer amount">{(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} />}</Field>
        <Field label="Date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Memo" className="sm:col-span-2">
          {(p) => <Textarea {...p} value={memo} onChange={(e) => setMemo(e.target.value)} />}
        </Field>
      </div>
      {amount ? (
        <p className="mt-6 text-text-muted">
          Moves <span className="num font-semibold text-text">{formatCents(amount)}</span> from {accounts.find((a) => a.id === from)?.name} to {accounts.find((a) => a.id === to)?.name}.
        </p>
      ) : null}
    </FormShell>
  );
}
