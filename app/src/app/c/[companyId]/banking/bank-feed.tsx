"use client";

import { ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { CategoryLines, isBlankCategory, withSpareCategories, type CategoryLine } from "@/components/category-lines";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import type { AccountType } from "@/lib/coa";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { AddSpec, Suggestion } from "@/lib/bank/feed";
import { addFeedTxnAction, batchAcceptAction, excludeFeedTxnsAction, matchFeedTxnAction, undoFeedTxnAction } from "./actions";
import { RuleDrawer } from "./rules/rule-drawer";

export interface FeedRow {
  id: string;
  date: string;
  description: string;
  bankText: string | null;
  amountCents: number;
  status: string;
  suggested: AddSpec | null;
  ruleName: string | null;
  suggestions: Suggestion[];
  result: { label: string; href: string; category: string | null } | null;
}

interface Props {
  companyId: string;
  tab: "review" | "categorized" | "excluded";
  accountType: "bank" | "credit_card";
  rows: FeedRow[];
  categories: { id: string; name: string; type: AccountType }[];
  contacts: { id: string; display_name: string; kind: string }[];
  transferAccounts: { id: string; name: string; type: string }[];
}

export function BankFeed(props: Props) {
  const { companyId, tab, rows } = props;
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [ruleFrom, setRuleFrom] = useState<FeedRow | null>(null);
  const names = new Map(props.categories.map((c) => [c.id, c.name]));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg">
        <EmptyState
          icon={Wand2}
          title={tab === "review" ? "Nothing to review" : tab === "categorized" ? "Nothing categorized yet" : "Nothing excluded"}
          body={tab === "review" ? "Import a file from your bank to bring in new transactions." : "Reviewed bank transactions show up here."}
        />
      </div>
    );
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    start(async () => {
      const res = await fn();
      setNotice(res.ok ? (success ? { ok: true, text: success } : null) : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) {
        setOpen(null);
        setSelected(new Set());
      }
      router.refresh();
    });
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={cn("rounded-md px-3 py-2", notice.ok ? "bg-success-soft text-on-success-soft" : "bg-danger-soft text-on-danger-soft")}>
          {notice.text}
        </p>
      )}
      {tab === "review" && selected.size > 0 && (
        <div className="sticky top-[calc(var(--header-height)+8px)] z-20 flex items-center gap-3 rounded-md border border-border bg-bg px-4 py-2 shadow-card">
          <span className="font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await batchAcceptAction(companyId, [...selected]);
                setNotice(res.ok ? { ok: true, text: `Accepted ${res.data.accepted}. ${res.data.skipped ? `${res.data.skipped} had no rule suggestion and were left for review.` : ""}` } : { ok: false, text: res.error });
                setSelected(new Set());
                router.refresh();
              })
            }
          >
            Accept suggestions
          </Button>
          <Button size="sm" onClick={() => run(() => excludeFeedTxnsAction(companyId, [...selected]), "Excluded.")}>
            Exclude
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-bg">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium tracking-wide text-text-muted uppercase">
              {tab === "review" && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-4 accent-[var(--color-accent)]"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
              )}
              <th className="w-8" />
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">{tab === "categorized" ? "Recorded as" : tab === "review" ? "Suggestion" : ""}</th>
              <th className="px-3 py-2 text-right">Spent</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="w-28 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open === r.id;
              const match = r.suggestions[0];
              return (
                <Fragment key={r.id}>
                  <tr className={cn("border-b border-border hover:bg-row-hover", isOpen && "bg-row-selected")}>
                    {tab === "review" && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.description}`}
                          className="size-4 accent-[var(--color-accent)]"
                          checked={selected.has(r.id)}
                          onChange={(e) => {
                            const s = new Set(selected);
                            if (e.target.checked) s.add(r.id);
                            else s.delete(r.id);
                            setSelected(s);
                          }}
                        />
                      </td>
                    )}
                    <td className="py-2 pl-2">
                      {tab === "review" && (
                        <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Close" : "Open"} ${r.description}`} onClick={() => setOpen(isOpen ? null : r.id)} className="rounded-sm p-1 text-text-muted hover:bg-surface">
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.description}</div>
                      {r.bankText && r.bankText !== r.description && <div className="text-sm text-text-muted">{r.bankText}</div>}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {tab === "categorized" && r.result && (
                        <Link href={r.result.href} className="text-accent hover:underline">
                          {r.result.label}
                          {r.result.category && <span className="text-text-muted"> · {r.result.category}</span>}
                        </Link>
                      )}
                      {tab === "review" && r.suggested && (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 text-on-accent-soft">
                          <Wand2 className="size-3" aria-hidden />
                          {r.suggested.kind === "transfer" ? "Transfer" : r.suggested.lines?.map((l) => names.get(l.accountId)).join(", ")}
                          {r.ruleName && <span className="opacity-75"> · rule: {r.ruleName}</span>}
                        </span>
                      )}
                      {tab === "review" && !r.suggested && match && (
                        <span className="inline-flex items-center rounded-pill bg-success-soft px-2 py-0.5 text-on-success-soft">
                          {r.suggestions.length === 1 ? "1 match found" : `${r.suggestions.length} matches found`}
                        </span>
                      )}
                    </td>
                    <td className="num px-3 py-2">{r.amountCents < 0 ? formatCents(-r.amountCents) : ""}</td>
                    <td className="num px-3 py-2">{r.amountCents > 0 ? formatCents(r.amountCents) : ""}</td>
                    <td className="px-3 py-2 text-right">
                      {tab === "review" ? (
                        r.suggested ? (
                          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => addFeedTxnAction(companyId, r.id, r.suggested))}>
                            Add
                          </Button>
                        ) : match && match.txnId ? (
                          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => matchFeedTxnAction(companyId, r.id, { kind: match.kind as "match" | "invoice" | "bill", txnId: match.txnId! }))}>
                            Match
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => setOpen(isOpen ? null : r.id)}>
                            Review
                          </Button>
                        )
                      ) : (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => undoFeedTxnAction(companyId, r.id), "Moved back to For review.")}>
                          Undo
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border bg-row-selected/40">
                      <td colSpan={8} className="px-6 py-4">
                        <ReviewPanel
                          {...props}
                          row={r}
                          pending={pending}
                          onAdd={(spec) => run(() => addFeedTxnAction(companyId, r.id, spec))}
                          onMatch={(s) => run(() => matchFeedTxnAction(companyId, r.id, { kind: s.kind as "match" | "invoice" | "bill", txnId: s.txnId! }))}
                          onExclude={() => run(() => excludeFeedTxnsAction(companyId, [r.id]))}
                          onCreateRule={() => setRuleFrom(r)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {ruleFrom && (
        <RuleDrawer
          companyId={companyId}
          open
          onOpenChange={(o) => !o && setRuleFrom(null)}
          categories={props.categories}
          contacts={props.contacts}
          feedAccounts={null}
          initial={{
            name: ruleFrom.description.slice(0, 40),
            direction: ruleFrom.amountCents < 0 ? "out" : "in",
            conditions: [{ field: "description", op: "contains", value: ruleFrom.description.split(/\s+#?\d/)[0].slice(0, 40) }],
          }}
          onSaved={(n) => {
            setNotice({ ok: true, text: `Rule saved. It now suggests a category for ${n} ${n === 1 ? "transaction" : "transactions"} waiting for review.` });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ReviewPanel({
  row,
  accountType,
  categories,
  contacts,
  transferAccounts,
  pending,
  onAdd,
  onMatch,
  onExclude,
  onCreateRule,
}: Props & {
  row: FeedRow;
  pending: boolean;
  onAdd: (spec: AddSpec) => void;
  onMatch: (s: Suggestion) => void;
  onExclude: () => void;
  onCreateRule: () => void;
}) {
  const abs = Math.abs(row.amountCents);
  const [mode, setMode] = useState<"categorize" | "match" | "transfer">(row.suggestions.length && !row.suggested ? "match" : row.suggested?.kind === "transfer" ? "transfer" : "categorize");
  const [contactId, setContactId] = useState<string | null>(row.suggested?.contactId ?? null);
  const [memo, setMemo] = useState(row.suggested?.memo ?? row.description);
  const [lines, setLines] = useState<CategoryLine[]>(() =>
    withSpareCategories(
      row.suggested?.lines?.length
        ? row.suggested.lines.map((l, i) => ({ key: 9000 + i, accountId: l.accountId, description: "", amountCents: l.amountCents }))
        : [{ key: 8999, accountId: null, description: "", amountCents: abs }],
    ),
  );
  const [other, setOther] = useState(row.suggested?.otherAccountId ?? transferAccounts[0]?.id ?? "");
  const [pick, setPick] = useState(0);
  const filled = lines.filter((l) => !isBlankCategory(l));
  const sum = filled.reduce((s, l) => s + (l.amountCents ?? 0), 0);
  const inflow = row.amountCents > 0;
  const recordedAs = !inflow ? "an expense" : accountType === "credit_card" ? "a credit card credit" : "a deposit";

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">How to record it</legend>
        {(
          [
            ["categorize", "Categorize"],
            ["match", `Find match${row.suggestions.length ? ` (${row.suggestions.length})` : ""}`],
            ["transfer", "Record as transfer"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="radio" name={`mode-${row.id}`} checked={mode === k} onChange={() => setMode(k)} className="accent-[var(--color-accent)]" />
            {label}
          </label>
        ))}
      </fieldset>

      {mode === "categorize" && (
        <>
          <p className="text-sm text-text-muted">Recorded as {recordedAs} in your books.</p>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <Field label={inflow ? "Received from" : "Payee"}>
              {(p) => <Combobox {...p} options={contacts.map((c) => ({ value: c.id, label: c.display_name, hint: c.kind }))} value={contactId} onChange={setContactId} placeholder="Optional" />}
            </Field>
            <Field label="Memo">{(p) => <Input {...p} value={memo} onChange={(e) => setMemo(e.target.value)} />}</Field>
          </div>
          <CategoryLines lines={lines} onChange={setLines} accounts={categories} label="Category" allowNegative={false} />
          {sum !== abs && filled.length > 0 && (
            <p className="text-sm text-danger" role="status">
              Lines add up to {formatCents(sum)}. They need to equal {formatCents(abs)}.
            </p>
          )}
        </>
      )}

      {mode === "match" &&
        (row.suggestions.length === 0 ? (
          <p className="text-text-muted">
            Nothing in your books moves {formatCents(abs)} through this account around {formatDate(row.date)}, and no open {inflow ? "invoice" : "bill"} is for that amount.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Records that match</legend>
            {row.suggestions.map((s, i) => (
              <label key={`${s.kind}-${s.txnId}`} className="flex items-center gap-2">
                <input type="radio" name={`pick-${row.id}`} checked={pick === i} onChange={() => setPick(i)} className="accent-[var(--color-accent)]" />
                <span>
                  {s.kind === "invoice" ? "Receive payment for " : s.kind === "bill" ? "Pay " : ""}
                  {s.label}
                </span>
                {s.detail && <span className="text-sm text-text-muted">{formatDate(s.detail)}</span>}
              </label>
            ))}
          </fieldset>
        ))}

      {mode === "transfer" && (
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field label={inflow ? "Transferred from" : "Transferred to"}>
            {(p) => (
              <NativeSelect {...p} value={other} onChange={(e) => setOther(e.target.value)}>
                {transferAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Memo">{(p) => <Input {...p} value={memo} onChange={(e) => setMemo(e.target.value)} />}</Field>
          <p className="text-sm text-text-muted sm:col-span-2">Use this for moving money between your own accounts, including paying a credit card from the bank.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onExclude} disabled={pending}>
            Exclude
          </Button>
          <Button size="sm" variant="ghost" onClick={onCreateRule}>
            Create rule
          </Button>
        </div>
        <Button
          variant="primary"
          loading={pending}
          disabled={(mode === "categorize" && (filled.length === 0 || sum !== abs || filled.some((l) => !l.accountId))) || (mode === "match" && row.suggestions.length === 0) || (mode === "transfer" && !other)}
          onClick={() => {
            if (mode === "match") return onMatch(row.suggestions[pick]);
            if (mode === "transfer") return onAdd({ kind: "transfer", otherAccountId: other, memo });
            onAdd({ kind: "categorize", contactId, memo, lines: filled.map((l) => ({ accountId: l.accountId!, amountCents: l.amountCents ?? 0, description: l.description || null })) });
          }}
        >
          {mode === "match" ? "Match" : "Add"}
        </Button>
      </div>
    </div>
  );
}
