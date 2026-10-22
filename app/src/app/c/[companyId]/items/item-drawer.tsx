"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, MoneyInput, NativeSelect, Textarea } from "@/components/ui/field";
import { saveItemAction } from "../actions";

export interface ItemDraft {
  id?: string;
  name: string;
  type?: "service" | "non_inventory";
  sku?: string;
  description?: string;
  salesPriceCents?: number | null;
  incomeAccountId?: string;
  taxable?: boolean;
}

export type SavedItem = { id: string; name: string; salesPriceCents: number | null; description: string | null; taxable: boolean };

interface Props {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ItemDraft;
  incomeAccounts: { id: string; name: string }[];
  onSaved?: (item: SavedItem) => void;
}

export function ItemDrawer({ companyId, open, onOpenChange, initial, incomeAccounts, onSaved }: Props) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [price, setPrice] = useState<number | null>(initial?.salesPriceCents ?? null);
  const defaultIncome = initial?.incomeAccountId ?? incomeAccounts.find((a) => a.name === "Services")?.id ?? incomeAccounts[0]?.id;

  function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? "");
    const payload = {
      id: initial?.id,
      name: s("name"),
      type: s("type"),
      sku: s("sku"),
      description: s("description"),
      salesPriceCents: price,
      incomeAccountId: s("incomeAccountId"),
      taxable: f.get("taxable") === "on",
    };
    start(async () => {
      const res = await saveItemAction(companyId, payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? { name: res.error });
        return;
      }
      setErrors({});
      onSaved?.(res.data);
      onOpenChange(false);
    });
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={initial?.id ? "Edit product or service" : "New product or service"}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="item-form" variant="primary" loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="item-form"
        key={initial?.id ?? initial?.name ?? "new"}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <Field label="Name" required error={errors.name}>
          {(p) => <Input {...p} name="name" defaultValue={initial?.name} required autoFocus />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            {(p) => (
              <NativeSelect {...p} name="type" defaultValue={initial?.type ?? "service"}>
                <option value="service">Service</option>
                <option value="non_inventory">Non-inventory product</option>
              </NativeSelect>
            )}
          </Field>
          <Field label="SKU" error={errors.sku}>
            {(p) => <Input {...p} name="sku" defaultValue={initial?.sku} />}
          </Field>
        </div>
        <Field label="Description on sales forms">{(p) => <Textarea {...p} name="description" defaultValue={initial?.description} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Price / rate" error={errors.salesPriceCents}>
            {(p) => <MoneyInput {...p} value={price} onValueChange={setPrice} />}
          </Field>
          <Field label="Income account" error={errors.incomeAccountId}>
            {(p) => (
              <NativeSelect {...p} name="incomeAccountId" defaultValue={defaultIncome}>
                {incomeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="taxable" defaultChecked={initial?.taxable ?? true} className="size-4 accent-[var(--color-accent)]" />
          Taxable
        </label>
      </form>
    </Drawer>
  );
}
