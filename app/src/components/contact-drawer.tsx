"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { saveContactAction } from "@/app/c/[companyId]/actions";

export interface CustomerDraft {
  id?: string;
  track1099?: boolean;
  taxId?: string;
  taxExempt?: boolean;
  defaultTaxRateId?: string;
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  termsId?: string;
  billingAddress?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string };
  notes?: string;
}

interface Props {
  kind?: "customer" | "vendor";
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CustomerDraft;
  terms: { id: string; name: string }[];
  taxRates?: { id: string; name: string }[];
  onSaved?: (c: { id: string; displayName: string; email: string | null; termsId: string | null }) => void;
}

export function CustomerDrawer({ kind = "customer", companyId, open, onOpenChange, initial, terms, taxRates = [], onSaved }: Props) {
  const noun = kind === "customer" ? "customer" : "vendor";
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? "");
    const payload = {
      id: initial?.id,
      kind,
      track1099: f.get("track1099") === "on",
      taxId: s("taxId"),
      taxExempt: f.get("taxExempt") === "on",
      defaultTaxRateId: s("defaultTaxRateId"),
      displayName: s("displayName"),
      companyName: s("companyName"),
      email: s("email"),
      phone: s("phone"),
      termsId: s("termsId"),
      billingAddress: { line1: s("line1"), line2: s("line2"), city: s("city"), state: s("state"), zip: s("zip") },
      notes: s("notes"),
    };
    start(async () => {
      const res = await saveContactAction(companyId, payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      setErrors({});
      setFormError(null);
      onSaved?.(res.data);
      onOpenChange(false);
    });
  }

  const formId = `${kind}-form`;
  const a = initial?.billingAddress ?? {};
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={initial?.id ? `Edit ${noun}` : `New ${noun}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id={formId}
        key={initial?.id ?? initial?.displayName ?? "new"}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        {formError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {formError}
          </p>
        )}
        <Field
          label={kind === "customer" ? "Customer display name" : "Vendor display name"}
          required
          error={errors.displayName}
          hint={kind === "customer" ? "How this customer appears on invoices and lists." : "How this vendor appears on bills, expenses and checks."}
        >
          {(p) => <Input {...p} name="displayName" defaultValue={initial?.displayName} required autoFocus />}
        </Field>
        <Field label="Company name" error={errors.companyName}>
          {(p) => <Input {...p} name="companyName" defaultValue={initial?.companyName} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Email" error={errors.email}>
            {(p) => <Input {...p} name="email" type="email" defaultValue={initial?.email} />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(p) => <Input {...p} name="phone" type="tel" defaultValue={initial?.phone} />}
          </Field>
        </div>
        <Field label="Payment terms" error={errors.termsId}>
          {(p) => (
            <NativeSelect {...p} name="termsId" defaultValue={initial?.termsId ?? ""}>
              <option value="">Company default</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{kind === "customer" ? "Billing address" : "Address"}</legend>
          <Input name="line1" aria-label="Street address" placeholder="Street address" defaultValue={a.line1} />
          <Input name="line2" aria-label="Address line 2" placeholder="Suite, unit (optional)" defaultValue={a.line2} />
          <div className="grid grid-cols-[1fr_5rem_7rem] gap-3">
            <Input name="city" aria-label="City" placeholder="City" defaultValue={a.city} />
            <Input name="state" aria-label="State" placeholder="State" defaultValue={a.state} />
            <Input name="zip" aria-label="ZIP code" placeholder="ZIP" defaultValue={a.zip} />
          </div>
        </fieldset>
        {kind === "customer" && (
          <div className="grid grid-cols-2 items-end gap-4">
            <Field label="Default sales tax">
              {(p) => (
                <NativeSelect {...p} name="defaultTaxRateId" defaultValue={initial?.defaultTaxRateId ?? ""}>
                  <option value="">Company default (none)</option>
                  {taxRates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <label className="flex h-9 items-center gap-2">
              <input type="checkbox" name="taxExempt" defaultChecked={initial?.taxExempt} className="size-4 accent-[var(--color-accent)]" />
              Tax exempt
            </label>
          </div>
        )}
        {kind === "vendor" && (
          <Field label="Tax ID (EIN or SSN)" hint="Needed for 1099s.">
            {(p) => <Input {...p} name="taxId" defaultValue={initial?.taxId} autoComplete="off" />}
          </Field>
        )}
        {kind === "vendor" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="track1099" defaultChecked={initial?.track1099} className="size-4 accent-[var(--color-accent)]" />
            Track payments for 1099
          </label>
        )}
        <Field label="Notes">{(p) => <Textarea {...p} name="notes" defaultValue={initial?.notes} />}</Field>
      </form>
    </Drawer>
  );
}
