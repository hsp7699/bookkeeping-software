"use client";

import { Trash2 } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Input, MoneyInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/coa";
import { ClassSelect } from "@/components/tracking-fields";

export interface CategoryLine {
  key: number;
  accountId: string | null;
  description: string;
  amountCents: number | null;
  classId?: string | null;
  billable?: boolean;
  customerId?: string | null;
  /** already on an invoice: billable and customer can't change */
  billed?: boolean;
}

let seq = 0;
export const blankCategoryLine = (): CategoryLine => ({ key: ++seq, accountId: null, description: "", amountCents: null });
export const isBlankCategory = (l: CategoryLine) => !l.accountId && !l.description && !l.amountCents;

export function withSpareCategories(lines: CategoryLine[]) {
  let trailing = 0;
  for (let i = lines.length - 1; i >= 0 && isBlankCategory(lines[i]); i--) trailing++;
  const out = [...lines];
  while (trailing < 2) {
    out.push(blankCategoryLine());
    trailing++;
  }
  return out;
}

/** Editable category lines: account, description, amount. Always two spare rows. */
export function CategoryLines({
  lines,
  onChange,
  accounts,
  allowNegative = true,
  label = "Category details",
  classes = [],
  customers,
}: {
  lines: CategoryLine[];
  onChange: (lines: CategoryLine[]) => void;
  accounts: { id: string; name: string; type: AccountType }[];
  allowNegative?: boolean;
  label?: string;
  classes?: { id: string; name: string }[];
  /** pass customers to show the Billable and Customer columns */
  customers?: { id: string; display_name: string }[];
}) {
  const custOptions = customers?.map((c) => ({ value: c.id, label: c.display_name })) ?? [];
  const options = accounts.map((a) => ({ value: a.id, label: a.name, hint: ACCOUNT_TYPE_LABELS[a.type] }));
  const update = (key: number, patch: Partial<CategoryLine>) => onChange(withSpareCategories(lines.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  return (
    <div>
      <h2 className="mb-2 text-md font-semibold">{label}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse" aria-label={label}>
          <thead>
            <tr className="text-left text-xs font-medium tracking-wide text-text-muted uppercase">
              <th className="w-8 px-1 py-2">#</th>
              <th className="w-72 px-1 py-2">Category</th>
              <th className="px-1 py-2">Description</th>
              <th className="w-36 px-1 py-2 text-right">Amount</th>
              {customers && <th className="w-16 px-1 py-2 text-center">Billable</th>}
              {customers && <th className="w-52 px-1 py-2">Customer</th>}
              {classes.length > 0 && <th className="w-40 px-1 py-2">Class</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.key} className="border-t border-border align-top">
                <td className="px-1 pt-2.5 text-text-muted">{idx + 1}</td>
                <td className="px-1 py-1.5">
                  <Combobox aria-label={`Line ${idx + 1} category`} options={options} value={l.accountId} onChange={(v) => update(l.key, { accountId: v })} placeholder="Choose a category" />
                </td>
                <td className="px-1 py-1.5">
                  <Input aria-label={`Line ${idx + 1} description`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                </td>
                <td className="px-1 py-1.5">
                  <MoneyInput aria-label={`Line ${idx + 1} amount`} allowNegative={allowNegative} value={l.amountCents} onValueChange={(v) => update(l.key, { amountCents: v })} />
                </td>
                {customers && (
                  <td className="px-1 pt-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Line ${idx + 1} billable`}
                      title={l.billed ? "Already billed on an invoice" : undefined}
                      disabled={l.billed}
                      checked={!!l.billable}
                      onChange={(e) => update(l.key, { billable: e.target.checked })}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                  </td>
                )}
                {customers && (
                  <td className="px-1 py-1.5">
                    <Combobox aria-label={`Line ${idx + 1} customer`} options={custOptions} value={l.customerId ?? null} onChange={(v) => update(l.key, { customerId: v })} placeholder="Optional" disabled={l.billed} />
                  </td>
                )}
                {classes.length > 0 && (
                  <td className="px-1 py-1.5">
                    <ClassSelect label={`Line ${idx + 1} class`} classes={classes} value={l.classId ?? null} onChange={(v) => update(l.key, { classId: v })} />
                  </td>
                )}
                <td className="pt-1.5">
                  {!isBlankCategory(l) && (
                    <button
                      type="button"
                      className="rounded-sm p-1.5 text-text-muted hover:bg-row-hover hover:text-danger"
                      aria-label={`Delete line ${idx + 1}`}
                      onClick={() => onChange(withSpareCategories(lines.filter((x) => x.key !== l.key)))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => onChange([...lines, blankCategoryLine()])}>
          Add line
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(withSpareCategories([]))}>
          Clear all lines
        </Button>
      </div>
    </div>
  );
}
