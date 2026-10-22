"use client";

import { Download } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { PRESETS } from "@/lib/reports/range";

/** Report controls. Everything lives in the URL, so a report can be bookmarked or shared. */
export function ReportToolbar({
  mode = "range",
  from,
  to,
  asOf,
  basis,
  preset,
  columns,
  showBasis = true,
  showColumns = false,
}: {
  mode?: "range" | "asOf";
  from?: string;
  to?: string;
  asOf?: string;
  basis?: string;
  preset?: string;
  columns?: string;
  showBasis?: boolean;
  showColumns?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [p, setP] = useState(preset ?? "fy_to_date");
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");
  const [a, setA] = useState(asOf ?? "");
  const [b, setB] = useState(basis ?? "accrual");
  const [c, setC] = useState(columns ?? "total");

  function run(next: Record<string, string> = {}) {
    const q = new URLSearchParams(sp);
    if (mode === "range") {
      const pr = next.range ?? p;
      q.set("range", pr);
      if (pr === "custom") {
        q.set("from", next.from ?? f);
        q.set("to", next.to ?? t);
      } else {
        q.delete("from");
        q.delete("to");
      }
    } else q.set("asOf", next.asOf ?? a);
    if (showBasis) q.set("basis", next.basis ?? b);
    if (showColumns) q.set("columns", next.columns ?? c);
    router.push(`?${q.toString()}`);
  }

  const csv = `${path}/csv?${sp.toString()}`;
  return (
    <form
      className="flex flex-wrap items-end gap-3 print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      {mode === "range" ? (
        <>
          <Field label="Report period" className="w-52">
            {(props) => (
              <NativeSelect
                {...props}
                value={p}
                onChange={(e) => {
                  setP(e.target.value);
                  if (e.target.value !== "custom") run({ range: e.target.value });
                }}
              >
                {PRESETS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="From" className="w-40">
            {(props) => <Input {...props} type="date" value={f} onChange={(e) => { setF(e.target.value); setP("custom"); }} />}
          </Field>
          <Field label="To" className="w-40">
            {(props) => <Input {...props} type="date" value={t} onChange={(e) => { setT(e.target.value); setP("custom"); }} />}
          </Field>
        </>
      ) : (
        <Field label="As of" className="w-44">
          {(props) => <Input {...props} type="date" value={a} onChange={(e) => setA(e.target.value)} />}
        </Field>
      )}
      {showColumns && (
        <Field label="Columns" className="w-40">
          {(props) => (
            <NativeSelect {...props} value={c} onChange={(e) => { setC(e.target.value); run({ columns: e.target.value }); }}>
              <option value="total">Total only</option>
              <option value="months">Months</option>
            </NativeSelect>
          )}
        </Field>
      )}
      {showBasis && (
        <fieldset className="flex h-9 items-center gap-3">
          <legend className="sr-only">Accounting method</legend>
          {["accrual", "cash"].map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" name="basis" value={m} checked={b === m} onChange={() => { setB(m); run({ basis: m }); }} className="accent-[var(--color-accent)]" />
              {m === "accrual" ? "Accrual" : "Cash"}
            </label>
          ))}
        </fieldset>
      )}
      <Button type="submit" variant="primary">
        Run report
      </Button>
      <div className="ml-auto flex gap-2">
        <Button asChild variant="ghost">
          <a href={csv}>
            <Download className="size-4" aria-hidden /> CSV
          </a>
        </Button>
        <Button variant="ghost" onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </form>
  );
}
