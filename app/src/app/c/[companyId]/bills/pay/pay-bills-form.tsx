"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, NativeSelect } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { payBillsAction } from "./actions";

export interface OpenBill {
  id: string;
  vendor_id: string;
  vendor: string;
  number: string | null;
  txn_date: string;
  due_date: string | null;
  total_cents: number;
  balance_cents: number;
  overdue: boolean;
}

export function PayBillsForm({
  companyId,
  today,
  bills,
  accounts,
}: {
  companyId: string;
  today: string;
  bills: OpenBill[];
  accounts: { id: string; name: string; type: string }[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [checkNo, setCheckNo] = useState("");
  const [pay, setPay] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = useMemo(() => Object.values(pay).reduce((a, b) => a + b, 0), [pay]);
  const chosen = Object.entries(pay).filter(([, v]) => v > 0);
  const isBank = accounts.find((a) => a.id === accountId)?.type === "bank";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/c/${companyId}/expenses`} className="text-sm text-accent hover:underline">
            ← Expenses
          </Link>
          <h1 className="mt-1 text-xl font-bold">Pay bills</h1>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium tracking-wide text-text-muted uppercase">Total payment</p>
          <p className="num text-display font-bold">{formatCents(total)}</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
          {done}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Payment account">
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
        <Field label="Payment date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        {isBank && (
          <Field label="Starting check no." hint="Optional. One check per vendor.">
            {(p) => <Input {...p} value={checkNo} onChange={(e) => setCheckNo(e.target.value)} inputMode="numeric" />}
          </Field>
        )}
      </div>
      {bills.length === 0 ? (
        <p className="rounded-lg border border-border bg-bg p-8 text-center text-text-muted">No open bills. Nicely done.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-bg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-text-muted uppercase">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Pay all bills"
                    className="size-4 accent-[var(--color-accent)]"
                    checked={bills.every((b) => pay[b.id] === b.balance_cents)}
                    onChange={(e) => setPay(e.target.checked ? Object.fromEntries(bills.map((b) => [b.id, b.balance_cents])) : {})}
                  />
                </th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Bill no.</th>
                <th className="px-3 py-2">Due date</th>
                <th className="px-3 py-2 text-right">Open balance</th>
                <th className="w-40 px-3 py-2 text-right">Payment</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-b border-border">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Pay ${b.vendor} bill ${b.number ?? formatDate(b.txn_date)}`}
                      className="size-4 accent-[var(--color-accent)]"
                      checked={(pay[b.id] ?? 0) > 0}
                      onChange={(e) => setPay({ ...pay, [b.id]: e.target.checked ? b.balance_cents : 0 })}
                    />
                  </td>
                  <td className="px-3 py-2">{b.vendor}</td>
                  <td className="px-3 py-2">
                    <Link className="text-accent hover:underline" href={`/c/${companyId}/bills/${b.id}`}>
                      {b.number ?? "—"}
                    </Link>
                  </td>
                  <td className={cn("px-3 py-2", b.overdue && "font-semibold text-danger")}>
                    {b.due_date ? formatDate(b.due_date) : ""}
                    {b.overdue && <span className="sr-only"> (overdue)</span>}
                  </td>
                  <td className="num px-3 py-2">{formatCents(b.balance_cents)}</td>
                  <td className="px-3 py-1.5">
                    <MoneyInput
                      aria-label={`Payment for ${b.vendor} bill ${b.number ?? ""}`}
                      value={pay[b.id] || null}
                      onValueChange={(v) => setPay({ ...pay, [b.id]: Math.min(v ?? 0, b.balance_cents) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button asChild>
          <Link href={`/c/${companyId}/expenses`}>Cancel</Link>
        </Button>
        <Button
          variant="primary"
          loading={pending}
          disabled={chosen.length === 0}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await payBillsAction(companyId, {
                accountId,
                txnDate: date,
                checkNumber: isBank && checkNo ? checkNo : undefined,
                payments: chosen.map(([billId, amountCents]) => ({ billId, amountCents, vendorId: bills.find((b) => b.id === billId)!.vendor_id })),
              });
              if (!res.ok) return setError(res.error);
              setPay({});
              setDone(`Recorded ${res.data.count} bill ${res.data.count === 1 ? "payment" : "payments"}.`);
              router.refresh();
            })
          }
        >
          Pay {chosen.length || ""} {chosen.length === 1 ? "bill" : "bills"}
        </Button>
      </div>
    </div>
  );
}
