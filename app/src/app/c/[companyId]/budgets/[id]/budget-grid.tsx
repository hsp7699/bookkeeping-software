"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input, MoneyInput } from "@/components/ui/field";
import { spreadEvenly } from "@/lib/budgets/periods";
import { formatCents } from "@/lib/money";
import type { Budget } from "@/lib/budgets";
import { deleteBudgetAction, saveBudgetAction } from "../actions";

const SECTIONS: [string, string][] = [
  ["income", "Income"],
  ["cost_of_goods_sold", "Cost of goods sold"],
  ["expense", "Expenses"],
  ["other_income", "Other income"],
  ["other_expense", "Other expenses"],
];
const SIGN: Record<string, number> = { income: 1, other_income: 1, cost_of_goods_sold: -1, expense: -1, other_expense: -1 };
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function BudgetGrid({ companyId, budget }: { companyId: string; budget: Budget }) {
  const router = useRouter();
  const [name, setName] = useState(budget.name);
  const [cells, setCells] = useState(() => Object.fromEntries(budget.accounts.map((a) => [a.id, a.periods])) as Record<string, number[]>);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const setRow = (id: string, periods: number[]) => {
    setCells((c) => ({ ...c, [id]: periods }));
    setDirty(true);
    setMsg(null);
  };
  const setCell = (id: string, i: number, v: number) => setRow(id, cells[id].map((x, j) => (j === i ? v : x)));

  const net = useMemo(() => Array.from({ length: 12 }, (_, i) => budget.accounts.reduce((s, a) => s + SIGN[a.type] * cells[a.id][i], 0)), [cells, budget.accounts]);
  const months = budget.months.map((m) => `${MONTH[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`);

  function save() {
    start(async () => {
      const res = await saveBudgetAction(companyId, budget.id, { name, rows: Object.entries(cells).map(([accountId, periods]) => ({ accountId, periods })) });
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setDirty(false);
      setMsg({ ok: true, text: "Budget saved." });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/c/${companyId}/budgets`} className="text-sm text-accent hover:underline">
            ← Budgets
          </Link>
          <label className="mt-1 flex items-center gap-2">
            <span className="sr-only">Budget name</span>
            <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="h-10 max-w-sm text-xl font-bold" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href={`/c/${companyId}/reports/budget-vs-actuals?budget=${budget.id}`}>Budget vs actuals</Link>
          </Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <Button variant="primary" loading={pending} onClick={save} disabled={!dirty && !pending}>
            Save budget
          </Button>
        </div>
      </div>
      <p className="text-sm text-text-muted">Type an amount in a month, or in Total to spread it evenly across the year. Enter expenses as positive numbers.</p>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-md px-3 py-2 ${msg.ok ? "bg-success-soft text-on-success-soft" : "bg-danger-soft text-on-danger-soft"}`}>
          {msg.text}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-bg">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted uppercase">
              <th className="sticky left-0 z-10 min-w-56 bg-bg px-3 py-2 text-left">Account</th>
              {months.map((m) => (
                <th key={m} className="min-w-28 px-1 py-2 text-right">
                  {m}
                </th>
              ))}
              <th className="min-w-32 px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          {SECTIONS.map(([type, title]) => {
            const rows = budget.accounts.filter((a) => a.type === type);
            if (!rows.length) return null;
            return (
              <tbody key={type}>
                <tr>
                  <th colSpan={14} className="bg-surface py-1.5 text-left font-semibold">
                    <span className="sticky left-0 px-3">{title}</span>
                  </th>
                </tr>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-border hover:bg-row-hover">
                    <th scope="row" className="sticky left-0 z-10 bg-bg px-3 py-1 text-left font-normal" style={{ paddingLeft: 12 + a.depth * 16 }}>
                      {a.name}
                    </th>
                    {cells[a.id].map((v, i) => (
                      <td key={i} className="px-1 py-1">
                        <MoneyInput aria-label={`${a.name} ${months[i]}`} value={v || null} onValueChange={(c) => setCell(a.id, i, c ?? 0)} className="h-8 text-right" />
                      </td>
                    ))}
                    <td className="px-1 py-1">
                      <MoneyInput
                        aria-label={`${a.name} total`}
                        value={sum(cells[a.id]) || null}
                        onValueChange={(c) => {
                          if ((c ?? 0) !== sum(cells[a.id])) setRow(a.id, spreadEvenly(c ?? 0));
                        }}
                        className="h-8 text-right font-medium"
                      />
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-border font-medium">
                  <th scope="row" className="sticky left-0 z-10 bg-bg px-3 py-1.5 text-left">
                    Total {title.toLowerCase()}
                  </th>
                  {Array.from({ length: 12 }, (_, i) => (
                    <td key={i} className="num px-3 py-1.5 text-right">
                      {formatCents(rows.reduce((s, r) => s + cells[r.id][i], 0))}
                    </td>
                  ))}
                  <td className="num px-3 py-1.5 text-right">{formatCents(rows.reduce((s, r) => s + sum(cells[r.id]), 0))}</td>
                </tr>
              </tbody>
            );
          })}
          <tfoot>
            <tr className="border-t-4 border-double border-text font-semibold">
              <th scope="row" className="sticky left-0 z-10 bg-bg px-3 py-2 text-left">
                Net income
              </th>
              {net.map((v, i) => (
                <td key={i} className={`num px-3 py-2 text-right ${v < 0 ? "text-negative-amount" : ""}`}>
                  {formatCents(v)}
                </td>
              ))}
              <td className="num px-3 py-2 text-right" data-testid="budget-net">
                {formatCents(sum(net))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${budget.name}?`}
        body="The budget and its amounts are removed. Your transactions aren't affected."
        confirmLabel="Delete"
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            await deleteBudgetAction(companyId, budget.id);
            router.push(`/c/${companyId}/budgets`);
          })
        }
      />
    </div>
  );
}
