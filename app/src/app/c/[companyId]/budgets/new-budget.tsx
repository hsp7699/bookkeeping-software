"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { createBudgetAction } from "./actions";

export function NewBudget({ companyId, years, defaultYear }: { companyId: string; years: { value: number; label: string }[]; defaultYear: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(defaultYear);
  const [name, setName] = useState(`${years.find((y) => y.value === defaultYear)?.label} budget`);
  const [startFrom, setStartFrom] = useState<"blank" | "last_year">("blank");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New budget
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="New budget"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await createBudgetAction(companyId, { name, fiscalYear: year, startFrom });
                  if (!res.ok) return setError(res.error);
                  router.push(`/c/${companyId}/budgets/${res.data.id}`);
                })
              }
            >
              Create budget
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
          <Field label="Fiscal year">
            {(p) => (
              <NativeSelect
                {...p}
                value={year}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setYear(y);
                  setName(`${years.find((x) => x.value === y)?.label} budget`);
                }}
              >
                {years.map((y) => (
                  <option key={y.value} value={y.value}>
                    {y.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Name" required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Start from</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="start" checked={startFrom === "blank"} onChange={() => setStartFrom("blank")} /> A blank budget
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="start" checked={startFrom === "last_year"} onChange={() => setStartFrom("last_year")} /> Last year&apos;s actual amounts
            </label>
          </fieldset>
        </div>
      </Drawer>
    </>
  );
}
