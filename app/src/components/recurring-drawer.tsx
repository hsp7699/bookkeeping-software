"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveRecurringAction } from "@/app/c/[companyId]/recurring/actions";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { describeSchedule, type IntervalUnit } from "@/lib/recurring/schedule";

export interface RecurringValues {
  id?: string;
  txnId?: string;
  txnType: string;
  name: string;
  mode: "scheduled" | "reminder";
  intervalUnit: IntervalUnit;
  intervalCount: number;
  dayOfMonth: number | null;
  nextDate: string;
  endDate: string | null;
  autoSend: boolean;
}

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** Set up or change how a transaction repeats. */
export function RecurringDrawer({ companyId, open, onOpenChange, initial }: { companyId: string; open: boolean; onOpenChange: (o: boolean) => void; initial: RecurringValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (open) {
      setV(initial);
      setErrors({});
      setError(null);
    }
  }, [open, initial]);
  const set = <K extends keyof RecurringValues>(k: K, val: RecurringValues[K]) => setV((o) => ({ ...o, [k]: val }));
  const monthly = v.intervalUnit !== "week";

  function save() {
    start(async () => {
      const res = await saveRecurringAction(companyId, { ...v, dayOfMonth: monthly ? v.dayOfMonth : null });
      if (!res.ok) {
        setError(res.error);
        setErrors(res.fieldErrors ?? {});
        return;
      }
      onOpenChange(false);
      if (v.id) router.refresh();
      else router.push(`/c/${companyId}/recurring`);
    });
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={v.id ? "Edit recurring template" : "Make recurring"}
      description={describeSchedule({ unit: v.intervalUnit, count: v.intervalCount || 1, dayOfMonth: monthly ? v.dayOfMonth : null })}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>
            Save template
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        <Field label="Template name" required error={errors.name}>
          {(p) => <Input {...p} value={v.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">When it&apos;s due</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" className="mt-1" checked={v.mode === "scheduled"} onChange={() => set("mode", "scheduled")} />
            <span>
              Create it automatically
              <span className="block text-sm text-text-muted">It&apos;s saved to your books on each date without you doing anything.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" className="mt-1" checked={v.mode === "reminder"} onChange={() => set("mode", "reminder")} />
            <span>
              Remind me
              <span className="block text-sm text-text-muted">It shows up as ready on the Recurring page, and you create it with one click.</span>
            </span>
          </label>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every" error={errors.intervalCount}>
            {(p) => <Input {...p} type="number" min={1} max={52} value={v.intervalCount || ""} onChange={(e) => set("intervalCount", Number(e.target.value))} />}
          </Field>
          <Field label="Unit">
            {(p) => (
              <NativeSelect {...p} value={v.intervalUnit} onChange={(e) => set("intervalUnit", e.target.value as IntervalUnit)}>
                <option value="week">{v.intervalCount === 1 ? "week" : "weeks"}</option>
                <option value="month">{v.intervalCount === 1 ? "month" : "months"}</option>
                <option value="year">{v.intervalCount === 1 ? "year" : "years"}</option>
              </NativeSelect>
            )}
          </Field>
        </div>
        {monthly && (
          <Field label="On day" hint="Short months use their last day.">
            {(p) => (
              <NativeSelect {...p} value={v.dayOfMonth ?? ""} onChange={(e) => set("dayOfMonth", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Same day as the start date</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value={31}>Last day of the month</option>
              </NativeSelect>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={v.id ? "Next date" : "Start date"} required error={errors.nextDate}>
            {(p) => <Input {...p} type="date" value={v.nextDate} onChange={(e) => set("nextDate", e.target.value)} />}
          </Field>
          <Field label="End date" hint="Optional" error={errors.endDate}>
            {(p) => <Input {...p} type="date" value={v.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />}
          </Field>
        </div>
        {v.txnType === "invoice" && v.mode === "scheduled" && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={v.autoSend} onChange={(e) => set("autoSend", e.target.checked)} />
            <span>
              Email each invoice to the customer when it&apos;s created
              <span className="block text-sm text-text-muted">Uses the email addresses on this invoice.</span>
            </span>
          </label>
        )}
        {!v.id && <p className="text-sm text-text-muted">This transaction stays as it is. The template copies its customer or vendor, lines and amounts; dates are set on each run.</p>}
      </div>
    </Drawer>
  );
}
