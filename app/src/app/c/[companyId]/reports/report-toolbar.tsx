"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { PRESETS } from "@/lib/reports/range";

/** Date range + basis controls. Writes them to the URL so a report is shareable. */
export function ReportToolbar({ from, to, basis, preset, showBasis = true }: { from: string; to: string; basis?: string; preset: string; showBasis?: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [p, setP] = useState(preset);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [b, setB] = useState(basis ?? "accrual");

  function run(next: { preset?: string; from?: string; to?: string; basis?: string }) {
    const q = new URLSearchParams(sp);
    const pr = next.preset ?? p;
    q.set("range", pr);
    if (pr === "custom") {
      q.set("from", next.from ?? f);
      q.set("to", next.to ?? t);
    } else {
      q.delete("from");
      q.delete("to");
    }
    if (showBasis) q.set("basis", next.basis ?? b);
    router.push(`?${q.toString()}`);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run({});
      }}
    >
      <Field label="Report period" className="w-52">
        {(props) => (
          <NativeSelect
            {...props}
            value={p}
            onChange={(e) => {
              setP(e.target.value);
              if (e.target.value !== "custom") run({ preset: e.target.value });
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
      {showBasis && (
        <fieldset className="flex h-9 items-center gap-3">
          <legend className="sr-only">Accounting method</legend>
          {["accrual", "cash"].map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="basis"
                value={m}
                checked={b === m}
                onChange={() => {
                  setB(m);
                  run({ basis: m });
                }}
                className="accent-[var(--color-accent)]"
              />
              {m === "accrual" ? "Accrual" : "Cash"}
            </label>
          ))}
        </fieldset>
      )}
      <Button type="submit" variant="primary">
        Run report
      </Button>
    </form>
  );
}
