"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, NativeSelect } from "@/components/ui/field";
import { saveTransactionAction } from "../actions";

export function RecordTaxPayment({ companyId, accounts, suggestedCents, today }: { companyId: string; accounts: { id: string; name: string }[]; suggestedCents: number; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(suggestedCents || null);
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="primary">Record tax payment</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg bg-bg p-6 shadow-pop">
          <Dialog.Title className="text-lg font-semibold">Record a sales tax payment</Dialog.Title>
          <Dialog.Description className="text-text-muted">For tax you&apos;ve paid to the agency. It reduces Sales Tax Payable.</Dialog.Description>
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
              {error}
            </p>
          )}
          <Field label="Amount paid">{(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} />}</Field>
          <Field label="Payment date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Paid from">
            {(p) => (
              <NativeSelect {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Memo">{(p) => <Input {...p} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Q3 return" />}</Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  if (!amount) return setError("Enter the amount paid.");
                  const res = await saveTransactionAction(companyId, { type: "sales_tax_payment", txnDate: date, accountId, amountCents: amount, memo: memo || "Sales tax payment" });
                  if (!res.ok) return setError(res.error);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Save payment
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
