"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TXN_LABEL, txnHref } from "@/lib/routes";
import type { ReconEntry } from "@/lib/reconcile";
import { discardAction, editStatementAction, finishAction, tickAction } from "../actions";

interface Props {
  companyId: string;
  reconId: string;
  accountName: string;
  accountType: "bank" | "credit_card";
  statementDate: string;
  beginningCents: number;
  endingCents: number;
  entries: ReconEntry[];
}

export function Workspace(p: Props) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(new Set(p.entries.filter((e) => e.ticked).map((e) => e.id)));
  const [tab, setTab] = useState<"all" | "out" | "in">("all");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(p.statementDate);
  const [ending, setEnding] = useState<number | null>(p.endingCents);
  const [pending, start] = useTransition();
  const card = p.accountType === "credit_card";

  const { cleared, ins, outs } = useMemo(() => {
    let ins = 0;
    let outs = 0;
    for (const e of p.entries) {
      if (!ticked.has(e.id)) continue;
      if (e.amount_cents > 0) ins += e.amount_cents;
      else outs -= e.amount_cents;
    }
    return { cleared: p.beginningCents + ins - outs, ins, outs };
  }, [p.entries, ticked, p.beginningCents]);
  const difference = p.endingCents - cleared;
  const shown = p.entries.filter((e) => tab === "all" || (tab === "in" ? e.amount_cents > 0 : e.amount_cents < 0));

  function toggle(ids: string[], on: boolean) {
    const next = new Set(ticked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setTicked(next); // optimistic; the server keeps the same set
    start(async () => {
      const res = await tickAction(p.companyId, p.reconId, ids, on);
      if (!res.ok) {
        setError(res.error);
        router.refresh();
      }
    });
  }

  function doFinish(adjust: boolean) {
    start(async () => {
      const res = await finishAction(p.companyId, p.reconId, adjust);
      if (!res.ok) return setError(res.error);
      router.replace(`/c/${p.companyId}/reconcile/${p.reconId}?done=1`);
      router.refresh();
    });
  }

  const inLabel = card ? "Charges" : "Deposits";
  const outLabel = card ? "Payments" : "Payments";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/c/${p.companyId}/reconcile`} className="text-sm text-accent hover:underline">
            ← Reconcile
          </Link>
          <h1 className="mt-1 text-xl font-bold">Reconcile {p.accountName}</h1>
          <p className="text-text-muted">Statement ending {formatDate(p.statementDate)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setEditing((v) => !v)}>
            Edit statement info
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              start(async () => {
                await discardAction(p.companyId, p.reconId);
                router.push(`/c/${p.companyId}/reconcile`);
              })
            }
          >
            Discard
          </Button>
          <Button asChild>
            <Link href={`/c/${p.companyId}/reconcile`}>Save for later</Link>
          </Button>
          <Button variant="primary" loading={pending} onClick={() => (difference === 0 ? doFinish(false) : setConfirm(true))}>
            Finish now
          </Button>
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-bg p-4">
          <Field label="Statement ending date">{(f) => <Input {...f} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Ending balance">{(f) => <MoneyInput {...f} allowNegative value={ending} onValueChange={setEnding} />}</Field>
          <Button
            onClick={() =>
              start(async () => {
                const res = await editStatementAction(p.companyId, p.reconId, date, ending ?? 0);
                if (!res.ok) return setError(res.error);
                setEditing(false);
                router.refresh();
              })
            }
          >
            Update
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
          {error}
        </p>
      )}

      <div className="sticky top-[var(--header-height)] z-20 grid grid-cols-2 gap-4 rounded-lg border border-border bg-bg p-4 shadow-card sm:grid-cols-5">
        <div>
          <p className="text-sm text-text-muted">Statement ending balance</p>
          <p className="num text-left text-lg font-semibold">{formatCents(p.endingCents)}</p>
        </div>
        <div>
          <p className="text-sm text-text-muted">Beginning balance</p>
          <p className="num text-left">{formatCents(p.beginningCents)}</p>
        </div>
        <div>
          <p className="text-sm text-text-muted">
            {ticked.size} cleared: {inLabel.toLowerCase()} / {outLabel.toLowerCase()}
          </p>
          <p className="num text-left">
            +{formatCents(ins)} / −{formatCents(outs)}
          </p>
        </div>
        <div>
          <p className="text-sm text-text-muted">Cleared balance</p>
          <p className="num text-left text-lg font-semibold">{formatCents(cleared)}</p>
        </div>
        <div aria-live="polite">
          <p className="text-sm text-text-muted">Difference</p>
          <p className={cn("num flex items-center gap-1.5 text-left text-xl font-bold", difference === 0 ? "text-success" : "text-text")}>
            {difference === 0 && <CheckCircle2 className="size-5" aria-hidden />}
            {formatCents(difference)}
          </p>
        </div>
      </div>

      <nav className="flex gap-1" aria-label="Filter">
        {(
          [
            ["all", "All"],
            ["out", card ? "Payments and credits" : "Payments"],
            ["in", card ? "Charges" : "Deposits"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={cn("rounded-pill px-3 py-1 text-sm font-medium", tab === k ? "bg-accent-soft text-on-accent-soft" : "text-text-muted hover:bg-row-hover")}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-lg border border-border bg-bg">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium tracking-wide text-text-muted uppercase">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Tick all shown"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={shown.length > 0 && shown.every((e) => ticked.has(e.id))}
                  onChange={(e) => toggle(shown.map((x) => x.id), e.target.checked)}
                />
              </th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Ref no.</th>
              <th className="px-3 py-2">Payee</th>
              <th className="px-3 py-2">Memo</th>
              <th className="px-3 py-2 text-right">{card ? "Payment" : "Payment"}</th>
              <th className="px-3 py-2 text-right">{card ? "Charge" : "Deposit"}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-text-muted">
                  Nothing recorded in this account up to the statement date.
                </td>
              </tr>
            )}
            {shown.map((e) => (
              <tr key={e.id} className={cn("border-b border-border hover:bg-row-hover", ticked.has(e.id) && "bg-row-selected")}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Cleared: ${TXN_LABEL[e.type]} ${formatDate(e.entry_date)} ${formatCents(Math.abs(e.amount_cents))}`}
                    className="size-4 accent-[var(--color-accent)]"
                    checked={ticked.has(e.id)}
                    onChange={(ev) => toggle([e.id], ev.target.checked)}
                  />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.entry_date)}</td>
                <td className="px-3 py-2">
                  <Link className="text-accent hover:underline" href={txnHref(p.companyId, e.type, e.transaction_id)}>
                    {TXN_LABEL[e.type]}
                  </Link>
                </td>
                <td className="px-3 py-2">{e.number}</td>
                <td className="px-3 py-2">{e.payee}</td>
                <td className="max-w-xs truncate px-3 py-2 text-text-muted">{e.memo}</td>
                {/* bank: money out = payment; card: money in (balance owed goes down) = payment */}
                <td className="num px-3 py-2">{e.amount_cents < 0 ? formatCents(-e.amount_cents) : ""}</td>
                <td className="num px-3 py-2">{e.amount_cents > 0 ? formatCents(e.amount_cents) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="The difference isn't zero"
        body={
          <>
            You&apos;re {formatCents(Math.abs(difference))} {difference > 0 ? "short of" : "over"} the statement. Usually that means a transaction is missing, doubled or has the wrong amount. You can keep
            looking, or finish and record a {formatCents(Math.abs(difference))} adjustment to Reconciliation Discrepancies.
          </>
        }
        confirmLabel="Add adjustment and finish"
        pending={pending}
        onConfirm={() => {
          setConfirm(false);
          doFinish(true);
        }}
      />
    </div>
  );
}
