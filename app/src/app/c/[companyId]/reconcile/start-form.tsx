"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, NativeSelect } from "@/components/ui/field";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { startAction } from "./actions";

export interface AccountChoice {
  id: string;
  name: string;
  type: "bank" | "credit_card";
  last_date: string | null;
  beginning_cents: number;
  reconciled_now_cents: number;
  in_progress: string | null;
}

export function StartForm({ companyId, accounts }: { companyId: string; accounts: AccountChoice[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [ending, setEnding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const a = accounts.find((x) => x.id === accountId);
  if (!a) return <p className="text-text-muted">Add a bank or credit card account first.</p>;
  const mismatch = a.last_date && a.beginning_cents !== a.reconciled_now_cents;
  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
          {error}
        </p>
      )}
      <Field label="Account" className="max-w-sm">
        {(p) => (
          <NativeSelect {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <p className="text-text-muted">
        {a.last_date ? `Last reconciled through ${formatDate(a.last_date)}, ending at ${formatCents(a.beginning_cents)}.` : "This account hasn't been reconciled yet. It starts from $0.00."}
      </p>
      {mismatch && (
        <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-on-warning-soft">
          A reconciled transaction was changed or deleted since then: reconciled items now add up to {formatCents(a.reconciled_now_cents)}, not {formatCents(a.beginning_cents)}. This statement will start from{" "}
          {formatCents(a.reconciled_now_cents)}. Check the audit log to find the change.
        </p>
      )}
      {a.in_progress ? (
        <Button variant="primary" className="self-start" onClick={() => router.push(`/c/${companyId}/reconcile/${a.in_progress}`)}>
          Resume reconciling
        </Button>
      ) : (
        <>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <Field label="Statement ending date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label={a.type === "credit_card" ? "Statement balance owed" : "Statement ending balance"}>
              {(p) => <MoneyInput {...p} allowNegative value={ending} onValueChange={setEnding} />}
            </Field>
          </div>
          <Button
            variant="primary"
            className="self-start"
            loading={pending}
            onClick={() =>
              start(async () => {
                if (!date || ending == null) return setError("Enter the statement's ending date and balance.");
                const res = await startAction(companyId, { accountId, statementDate: date, endingCents: ending });
                if (!res.ok) return setError(res.error);
                router.push(`/c/${companyId}/reconcile/${res.data.id}`);
              })
            }
          >
            Start reconciling
          </Button>
        </>
      )}
    </div>
  );
}
