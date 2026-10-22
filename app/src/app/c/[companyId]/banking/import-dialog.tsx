"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/field";
import type { BankRow, ColumnMap } from "@/lib/bank/parse";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { commitImportAction, csvPreviewWithMapAction, linkFeedAccountAction, previewImportAction } from "./actions";

export function LinkAccountForm({ companyId, accounts, compact }: { companyId: string; accounts: { id: string; name: string; type: string }[]; compact?: boolean }) {
  const router = useRouter();
  const [id, setId] = useState(accounts[0]?.id ?? "");
  const [pending, start] = useTransition();
  if (accounts.length === 0) return <p className="text-text-muted">Add a bank or credit card account in the chart of accounts first.</p>;
  return (
    <div className="flex items-end gap-2">
      <Field label={compact ? "Add an account" : "Account in your books"}>
        {(p) => (
          <NativeSelect {...p} value={id} onChange={(e) => setId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Button
        variant={compact ? "secondary" : "primary"}
        loading={pending}
        onClick={() =>
          start(async () => {
            const res = await linkFeedAccountAction(companyId, id);
            if (res.ok) router.push(`/c/${companyId}/banking?account=${res.data.id}`);
            router.refresh();
          })
        }
      >
        {compact ? "Add" : "Use this account"}
      </Button>
    </div>
  );
}

type Preview = { rows: BankRow[]; total: number; errors: { line: number; message: string }[]; table: string[][] | null; map: ColumnMap | null; format: string };

export function ImportButton({ companyId, feedAccountId, accountName }: { companyId: string; feedAccountId: string; accountName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setFile(null);
    setPreview(null);
    setMap(null);
    setError(null);
    setResult(null);
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    reset();
    const text = await f.text();
    setFile({ name: f.name, text });
    start(async () => {
      const res = await previewImportAction(companyId, f.name, text);
      if (!res.ok) return setError(res.error);
      setPreview(res);
      setMap(res.map);
    });
  }

  function remap(next: ColumnMap) {
    setMap(next);
    if (!file) return;
    start(async () => {
      const res = await csvPreviewWithMapAction(companyId, file.text, next);
      setPreview((p) => (p ? { ...p, ...res } : p));
    });
  }

  const cols = preview?.table?.[0]?.map((h, i) => ({ i, label: map?.hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}: ${h}` })) ?? [];
  const colSelect = (label: string, value: number | null | undefined, onChange: (v: number | null) => void, allowNone = false) => (
    <Field label={label}>
      {(p) => (
        <NativeSelect {...p} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
          {allowNone && <option value="">None</option>}
          {cols.map((c) => (
            <option key={c.i} value={c.i}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Dialog.Trigger asChild>
        <Button variant="primary">
          <Upload className="size-4" aria-hidden /> Import file
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg bg-bg p-6 shadow-pop">
          <Dialog.Title className="text-lg font-semibold">Import bank transactions into {accountName}</Dialog.Title>
          <Dialog.Description className="text-text-muted">
            Download transactions from your bank&apos;s website as CSV, OFX, QFX or QBO. Anything already imported is skipped, so overlapping date ranges are fine.
          </Dialog.Description>
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
              {error}
            </p>
          )}
          {result ? (
            <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
              {result}
            </p>
          ) : (
            <>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border-input p-6 text-text-muted hover:bg-row-hover">
                <Upload className="size-6" aria-hidden />
                <span>{file ? file.name : "Choose a file"}</span>
                <input type="file" accept=".csv,.ofx,.qfx,.qbo,text/csv" className="sr-only" aria-label="Bank file" onChange={(e) => pick(e.target.files?.[0])} />
              </label>

              {preview && map && preview.table && (
                <fieldset className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-3">
                  <legend className="px-1 text-sm font-medium">Match the columns</legend>
                  <label className="flex items-center gap-2 sm:col-span-3">
                    <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={map.hasHeader} onChange={(e) => remap({ ...map, hasHeader: e.target.checked })} />
                    The first row is column names
                  </label>
                  {colSelect("Date", map.date, (v) => remap({ ...map, date: v ?? 0 }))}
                  {colSelect("Description", map.description, (v) => remap({ ...map, description: v ?? 0 }))}
                  <Field label="Date format">
                    {(p) => (
                      <NativeSelect {...p} value={map.dateFormat} onChange={(e) => remap({ ...map, dateFormat: e.target.value as ColumnMap["dateFormat"] })}>
                        <option value="MDY">MM/DD/YYYY</option>
                        <option value="DMY">DD/MM/YYYY</option>
                        <option value="YMD">YYYY-MM-DD</option>
                      </NativeSelect>
                    )}
                  </Field>
                  <Field label="Amounts are in">
                    {(p) => (
                      <NativeSelect
                        {...p}
                        value={map.amount != null ? "one" : "two"}
                        onChange={(e) =>
                          remap(e.target.value === "one" ? { ...map, amount: map.amount ?? 0, debit: null, credit: null } : { ...map, amount: null, debit: map.debit ?? 0, credit: map.credit ?? 0 })
                        }
                      >
                        <option value="one">One column (− is money out)</option>
                        <option value="two">Two columns (money out, money in)</option>
                      </NativeSelect>
                    )}
                  </Field>
                  {map.amount != null ? (
                    colSelect("Amount", map.amount, (v) => remap({ ...map, amount: v }))
                  ) : (
                    <>
                      {colSelect("Money out", map.debit, (v) => remap({ ...map, debit: v }), true)}
                      {colSelect("Money in", map.credit, (v) => remap({ ...map, credit: v }), true)}
                    </>
                  )}
                  <label className="flex items-center gap-2 sm:col-span-3">
                    <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={!!map.invert} onChange={(e) => remap({ ...map, invert: e.target.checked })} />
                    Flip signs (use this if charges show as positive numbers)
                  </label>
                </fieldset>
              )}

              {preview && (
                <div>
                  <p className="mb-2 text-sm text-text-muted">
                    {preview.total} {preview.total === 1 ? "transaction" : "transactions"} found{preview.total > preview.rows.length ? `, first ${preview.rows.length} shown` : ""}.
                  </p>
                  {preview.errors.length > 0 && (
                    <ul className="mb-2 text-sm text-danger">
                      {preview.errors.map((e) => (
                        <li key={e.line}>
                          Line {e.line}: {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs tracking-wide text-text-muted uppercase">
                        <th className="py-1">Date</th>
                        <th className="py-1">Description</th>
                        <th className="py-1 text-right">Spent</th>
                        <th className="py-1 text-right">Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.externalId} className="border-b border-border">
                          <td className="py-1">{formatDate(r.date)}</td>
                          <td className="py-1">{r.description}</td>
                          <td className="num py-1">{r.amountCents < 0 ? formatCents(-r.amountCents) : ""}</td>
                          <td className="num py-1">{r.amountCents > 0 ? formatCents(r.amountCents) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              {result ? "Done" : "Cancel"}
            </Button>
            {!result && (
              <Button
                variant="primary"
                loading={pending}
                disabled={!preview || preview.total === 0}
                onClick={() =>
                  start(async () => {
                    const res = await commitImportAction(companyId, feedAccountId, file!.name, file!.text, map);
                    if (!res.ok) return setError(res.error);
                    const { added, duplicates, autoAdded } = res.data;
                    setResult(
                      `Imported ${added} new ${added === 1 ? "transaction" : "transactions"}` +
                        (duplicates ? `, skipped ${duplicates} already imported` : "") +
                        (autoAdded ? `, and ${autoAdded} were added automatically by rules` : "") +
                        ".",
                    );
                    router.refresh();
                  })
                }
              >
                Import {preview?.total ?? ""}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
