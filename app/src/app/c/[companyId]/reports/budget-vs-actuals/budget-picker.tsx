"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Field, NativeSelect } from "@/components/ui/field";

export function BudgetPicker({ budgets, value }: { budgets: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <Field label="Budget" className="max-w-xs print:hidden">
      {(p) => (
        <NativeSelect
          {...p}
          value={value}
          onChange={(e) => {
            const q = new URLSearchParams(sp);
            q.set("budget", e.target.value);
            router.push(`${path}?${q.toString()}`);
          }}
        >
          {budgets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
