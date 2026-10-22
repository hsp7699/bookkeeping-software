"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import type { RuleCondition, RuleField, RuleOp } from "@/lib/bank/rules";
import type { AccountType } from "@/lib/coa";
import { saveRuleAction } from "../actions";

export interface RuleDraft {
  id?: string;
  name: string;
  direction: "in" | "out" | "both";
  feedAccountIds?: string[] | null;
  matchMode?: "all" | "any";
  conditions: RuleCondition[];
  actions?: { txnType: "expense" | "deposit" | "transfer"; contactId?: string | null; memo?: string | null; splits: { accountId: string; percentBp?: number }[] };
  autoConfirm?: boolean;
}

const FIELDS: [RuleField, string][] = [
  ["description", "Description"],
  ["bank_text", "Bank text"],
  ["amount", "Amount"],
];
const TEXT_OPS: [RuleOp, string][] = [
  ["contains", "contains"],
  ["not_contains", "doesn't contain"],
  ["equals", "is exactly"],
];
const AMOUNT_OPS: [RuleOp, string][] = [
  ["equals", "equals"],
  ["gt", "is more than"],
  ["lt", "is less than"],
];

interface Split {
  key: number;
  accountId: string | null;
  percent: string;
}
let seq = 0;

export function RuleDrawer({
  companyId,
  open,
  onOpenChange,
  categories,
  contacts,
  feedAccounts,
  initial,
  onSaved,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: { id: string; name: string; type: AccountType }[];
  contacts: { id: string; display_name: string; kind: string }[];
  feedAccounts: { id: string; name: string }[] | null;
  initial: RuleDraft;
  onSaved: (reapplied: number) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial.name);
  const [direction, setDirection] = useState(initial.direction);
  const [feedIds, setFeedIds] = useState<string[] | null>(initial.feedAccountIds ?? null);
  const [mode, setMode] = useState(initial.matchMode ?? "all");
  const [conds, setConds] = useState(initial.conditions.map((c) => ({ ...c, key: ++seq })));
  const [txnType, setTxnType] = useState(initial.actions?.txnType ?? (direction === "in" ? "deposit" : "expense"));
  const [contactId, setContactId] = useState<string | null>(initial.actions?.contactId ?? null);
  const [memo, setMemo] = useState(initial.actions?.memo ?? "");
  const [splits, setSplits] = useState<Split[]>(
    (initial.actions?.splits ?? [{ accountId: "", percentBp: 10000 }]).map((s) => ({ key: ++seq, accountId: s.accountId || null, percent: String((s.percentBp ?? 10000) / 100) })),
  );
  const [auto, setAuto] = useState(initial.autoConfirm ?? false);
  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  function save() {
    setError(null);
    start(async () => {
      const res = await saveRuleAction(companyId, {
        id: initial.id,
        name,
        direction,
        feedAccountIds: feedIds,
        matchMode: mode,
        conditions: conds.map(({ field, op, value }) => ({ field, op, value })),
        actions: {
          txnType,
          contactId,
          memo: memo || null,
          splits: splits.map((s) => ({ accountId: s.accountId ?? "", percentBp: splits.length > 1 ? Math.round(Number(s.percent) * 100) : undefined })),
        },
        autoConfirm: auto,
      });
      if (!res.ok) return setError(res.error);
      onOpenChange(false);
      onSaved(res.data.reapplied);
    });
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={initial.id ? "Edit rule" : "New rule"}
      description="Rules suggest how to record bank transactions that match."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        <Field label="Rule name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Apply to">
            {(p) => (
              <NativeSelect {...p} value={direction} onChange={(e) => setDirection(e.target.value as RuleDraft["direction"])}>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
                <option value="both">Both</option>
              </NativeSelect>
            )}
          </Field>
          {feedAccounts && (
            <Field label="In">
              {(p) => (
                <NativeSelect {...p} value={feedIds?.[0] ?? ""} onChange={(e) => setFeedIds(e.target.value ? [e.target.value] : null)}>
                  <option value="">All bank accounts</option>
                  {feedAccounts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 flex items-center gap-2 text-sm font-medium">
            When
            <NativeSelect aria-label="Match all or any conditions" value={mode} onChange={(e) => setMode(e.target.value as "all" | "any")} className="h-7 w-24 py-0">
              <option value="all">all</option>
              <option value="any">any</option>
            </NativeSelect>
            of these are true
          </legend>
          {conds.map((c, i) => (
            <div key={c.key} className="grid grid-cols-[8rem_9rem_1fr_auto] gap-2">
              <NativeSelect
                aria-label={`Condition ${i + 1} field`}
                value={c.field}
                onChange={(e) => {
                  const field = e.target.value as RuleField;
                  setConds(conds.map((x) => (x.key === c.key ? { ...x, field, op: field === "amount" ? "equals" : "contains" } : x)));
                }}
              >
                {FIELDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label={`Condition ${i + 1} test`} value={c.op} onChange={(e) => setConds(conds.map((x) => (x.key === c.key ? { ...x, op: e.target.value as RuleOp } : x)))}>
                {(c.field === "amount" ? AMOUNT_OPS : TEXT_OPS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
              <Input aria-label={`Condition ${i + 1} value`} value={c.value} inputMode={c.field === "amount" ? "decimal" : undefined} onChange={(e) => setConds(conds.map((x) => (x.key === c.key ? { ...x, value: e.target.value } : x)))} />
              <button type="button" aria-label={`Remove condition ${i + 1}`} disabled={conds.length === 1} className="rounded-sm p-2 text-text-muted hover:bg-row-hover disabled:opacity-30" onClick={() => setConds(conds.filter((x) => x.key !== c.key))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setConds([...conds, { key: ++seq, field: "description", op: "contains", value: "" }])}>
            <Plus className="size-4" aria-hidden /> Add a condition
          </Button>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Then</legend>
          <Field label="Record as">
            {(p) => (
              <NativeSelect {...p} value={txnType} onChange={(e) => setTxnType(e.target.value as typeof txnType)}>
                <option value="expense">Expense</option>
                <option value="deposit">Deposit</option>
                <option value="transfer">Transfer</option>
              </NativeSelect>
            )}
          </Field>
          {txnType !== "transfer" && (
            <Field label="Payee">
              {(p) => <Combobox {...p} options={contacts.map((c) => ({ value: c.id, label: c.display_name }))} value={contactId} onChange={setContactId} placeholder="Optional" />}
            </Field>
          )}
          {splits.map((s, i) => (
            <div key={s.key} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
              <Field label={txnType === "transfer" ? "Other account" : splits.length > 1 ? `Category ${i + 1}` : "Category"}>
                {(p) => <Combobox {...p} options={catOptions} value={s.accountId} onChange={(v) => setSplits(splits.map((x) => (x.key === s.key ? { ...x, accountId: v } : x)))} placeholder="Choose" />}
              </Field>
              {splits.length > 1 ? (
                <Field label="Percent">{(p) => <Input {...p} inputMode="decimal" value={s.percent} onChange={(e) => setSplits(splits.map((x) => (x.key === s.key ? { ...x, percent: e.target.value } : x)))} />}</Field>
              ) : (
                <span />
              )}
              {splits.length > 1 && (
                <button type="button" aria-label={`Remove split ${i + 1}`} className="mb-1 rounded-sm p-2 text-text-muted hover:bg-row-hover" onClick={() => setSplits(splits.filter((x) => x.key !== s.key))}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
          {txnType !== "transfer" && (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setSplits([...splits.map((s) => ({ ...s, percent: "50" })), { key: ++seq, accountId: null, percent: "50" }])}>
              <Plus className="size-4" aria-hidden /> Split by percentage
            </Button>
          )}
          <Field label="Memo">{(p) => <Input {...p} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Leave blank to use the bank description" />}</Field>
        </fieldset>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>
            Add matching transactions automatically
            <span className="block text-sm text-text-muted">Otherwise the rule only suggests, and you confirm each one.</span>
          </span>
        </label>
      </div>
    </Drawer>
  );
}
