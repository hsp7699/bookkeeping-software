"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormShell } from "@/components/form-shell";
import { TxnMoreMenu } from "@/components/txn-more-menu";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, MoneyInput, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/coa";
import { formatCents } from "@/lib/money";
import { saveTransactionAction } from "../actions";

export interface JournalDetail {
  id: string;
  number: string | null;
  txn_date: string;
  memo: string | null;
  status: string;
  updated_at: string;
  lines: { account_id: string; amount_cents: number; kind: "debit" | "credit"; description: string | null; contact_id: string | null }[];
}

interface Line {
  key: number;
  accountId: string | null;
  debit: number | null;
  credit: number | null;
  description: string;
  contactId: string | null;
}

let seq = 0;
const blank = (): Line => ({ key: ++seq, accountId: null, debit: null, credit: null, description: "", contactId: null });
const isBlank = (l: Line) => !l.accountId && !l.debit && !l.credit && !l.description;
function withSpare(lines: Line[]) {
  let trailing = 0;
  for (let i = lines.length - 1; i >= 0 && isBlank(lines[i]); i--) trailing++;
  const out = [...lines];
  while (trailing < 2) {
    out.push(blank());
    trailing++;
  }
  return out;
}

export function JournalForm({
  companyId,
  today,
  accounts,
  contacts,
  initial,
}: {
  companyId: string;
  today: string;
  accounts: { id: string; name: string; type: AccountType }[];
  contacts: { id: string; display_name: string; kind: string }[];
  initial: JournalDetail | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closePassword, setClosePassword] = useState<string | null>(null);
  const [date, setDate] = useState(initial?.txn_date ?? today);
  const [number, setNumber] = useState(initial?.number ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    withSpare(
      (initial?.lines ?? []).map((l) => ({
        key: ++seq,
        accountId: l.account_id,
        debit: l.kind === "debit" ? l.amount_cents : null,
        credit: l.kind === "credit" ? l.amount_cents : null,
        description: l.description ?? "",
        contactId: l.contact_id,
      })),
    ),
  );
  const filled = lines.filter((l) => !isBlank(l));
  const debits = filled.reduce((s, l) => s + (l.debit ?? 0), 0);
  const credits = filled.reduce((s, l) => s + (l.credit ?? 0), 0);
  const voided = initial?.status === "voided";
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => withSpare(ls.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name, hint: ACCOUNT_TYPE_LABELS[a.type] }));
  const contactOptions = contacts.map((c) => ({ value: c.id, label: c.display_name, hint: c.kind.charAt(0).toUpperCase() + c.kind.slice(1) }));

  function save() {
    setError(null);
    const bad = filled.findIndex((l) => !l.accountId || (!l.debit && !l.credit) || (l.debit && l.credit));
    if (bad >= 0) return setError(`Line ${bad + 1}: choose an account and enter either a debit or a credit.`);
    if (debits !== credits) return setError(`Debits and credits must be equal. They're off by ${formatCents(Math.abs(debits - credits))}.`);
    start(async () => {
      const res = await saveTransactionAction(
        companyId,
        {
          type: "journal_entry",
          id: initial?.id,
          ifUpdatedAt: initial?.updated_at,
          txnDate: date,
          number: number.trim() || null,
          memo: memo || null,
          lines: filled.map((l) => ({
            accountId: l.accountId,
            amountCents: l.debit ?? l.credit ?? 0,
            side: l.debit ? "debit" : "credit",
            description: l.description || null,
            contactId: l.contactId,
          })),
        },
        closePassword ?? undefined,
      );
      if (!res.ok) {
        if (res.error.includes("closed period") && closePassword == null) setClosePassword("");
        return setError(res.error);
      }
      router.replace(`/c/${companyId}/journal-entries/${res.data.id}?saved=1`);
      router.refresh();
    });
  }

  return (
    <FormShell
      title={initial ? `Journal entry ${initial.number ?? ""}` : "New journal entry"}
      status={voided ? <StatusPill tone="voided">Voided</StatusPill> : undefined}
      closeHref={`/c/${companyId}/accounts`}
      error={error}
      closePassword={closePassword}
      onClosePassword={setClosePassword}
      saveId="je-save"
      left={
        <>
          <Button asChild>
            <Link href={`/c/${companyId}/accounts`}>Cancel</Link>
          </Button>
          {initial && (
            <TxnMoreMenu
              companyId={companyId}
              txnId={initial.id}
              label="journal entry"
              voided={voided}
              afterDelete={`/c/${companyId}/accounts`}
              recur={{ txnType: "journal_entry", txnDate: initial.txn_date, name: initial.memo ? initial.memo.slice(0, 80) : "Journal entry" }}
            />
          )}
        </>
      }
      right={
        <Button id="je-save" variant="primary" loading={pending} disabled={voided} onClick={save}>
          Save
        </Button>
      }
    >
      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
        <Field label="Journal date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Journal no." hint={initial ? undefined : "Leave blank for the next number"}>
          {(p) => <Input {...p} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={21} />}
        </Field>
      </div>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse" aria-label="Journal lines">
          <thead>
            <tr className="text-left text-xs font-medium tracking-wide text-text-muted uppercase">
              <th className="w-8 px-1 py-2">#</th>
              <th className="w-64 px-1 py-2">Account</th>
              <th className="w-36 px-1 py-2 text-right">Debits</th>
              <th className="w-36 px-1 py-2 text-right">Credits</th>
              <th className="px-1 py-2">Description</th>
              <th className="w-52 px-1 py-2">Name</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.key} className="border-t border-border align-top">
                <td className="px-1 pt-2.5 text-text-muted">{idx + 1}</td>
                <td className="px-1 py-1.5">
                  <Combobox aria-label={`Line ${idx + 1} account`} options={accountOptions} value={l.accountId} onChange={(v) => update(l.key, { accountId: v })} placeholder="Choose an account" />
                </td>
                <td className="px-1 py-1.5">
                  <MoneyInput aria-label={`Line ${idx + 1} debit`} value={l.debit} onValueChange={(v) => update(l.key, { debit: v, credit: v ? null : l.credit })} />
                </td>
                <td className="px-1 py-1.5">
                  <MoneyInput aria-label={`Line ${idx + 1} credit`} value={l.credit} onValueChange={(v) => update(l.key, { credit: v, debit: v ? null : l.debit })} />
                </td>
                <td className="px-1 py-1.5">
                  <Input aria-label={`Line ${idx + 1} description`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                </td>
                <td className="px-1 py-1.5">
                  <Combobox aria-label={`Line ${idx + 1} name`} options={contactOptions} value={l.contactId} onChange={(v) => update(l.key, { contactId: v })} placeholder="Optional" />
                </td>
                <td className="pt-1.5">
                  {!isBlank(l) && (
                    <button type="button" className="rounded-sm p-1.5 text-text-muted hover:bg-row-hover hover:text-danger" aria-label={`Delete line ${idx + 1}`} onClick={() => setLines((ls) => withSpare(ls.filter((x) => x.key !== l.key)))}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-text font-semibold">
              <td />
              <td className="px-1 py-2">Total</td>
              <td className="num px-3 py-2">{formatCents(debits)}</td>
              <td className="num px-3 py-2">{formatCents(credits)}</td>
              <td colSpan={3} className={cn("px-1 py-2", debits === credits ? "text-success" : "text-danger")} aria-live="polite">
                {debits === credits ? (debits ? "Balanced" : "") : `Off by ${formatCents(Math.abs(debits - credits))}`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Field label="Memo" className="mt-6 max-w-2xl">
        {(p) => <Textarea {...p} value={memo} onChange={(e) => setMemo(e.target.value)} />}
      </Field>
    </FormShell>
  );
}
