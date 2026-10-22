"use client";

import { Trash2 } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Input, MoneyInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/coa";

export interface CategoryLine {
  key: number;
  accountId: string | null;
  description: string;
  amountCents: number | null;
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
}: {
  lines: CategoryLine[];
  onChange: (lines: CategoryLine[]) => void;
  accounts: { id: string; name: string; type: AccountType }[];
  allowNegative?: boolean;
  label?: string;
}) {
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
