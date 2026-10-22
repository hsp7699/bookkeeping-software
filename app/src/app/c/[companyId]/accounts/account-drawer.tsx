"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, MoneyInput, NativeSelect, Textarea } from "@/components/ui/field";
import { ACCOUNT_TYPE_LABELS, BALANCE_SHEET_TYPES, DETAIL_TYPES, humanize, type AccountType } from "@/lib/coa";
import { saveAccountAction } from "./actions";

export interface AccountDraft {
  id?: string;
  name: string;
  number?: string | null;
  type: AccountType;
  detailType: string;
  parentId?: string | null;
  description?: string | null;
  system?: boolean;
}

interface Props {
  companyId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: AccountDraft;
  parents: { id: string; name: string; type: AccountType }[];
  today: string;
}

export function AccountDrawer({ companyId, open, onOpenChange, initial, parents, today }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [type, setType] = useState<AccountType>(initial?.type ?? "expense");
  const [detail, setDetail] = useState(initial?.detailType ?? DETAIL_TYPES.expense[0]);
  const [opening, setOpening] = useState<number | null>(null);
  const [openingDate, setOpeningDate] = useState(today);
  const isNew = !initial?.id;

  function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? "");
    start(async () => {
      const res = await saveAccountAction(companyId, {
        id: initial?.id,
        name: s("name"),
        number: s("number"),
        type,
        detailType: detail,
        parentId: s("parentId"),
        description: s("description"),
        openingBalanceCents: isNew ? opening : null,
        openingBalanceDate: openingDate,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={isNew ? "New account" : "Edit account"}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="account-form" variant="primary" loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="account-form"
        key={initial?.id ?? "new"}
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
        {initial?.system && (
          <p className="rounded-md bg-info-soft px-3 py-2 text-on-info-soft">The books use this account automatically. You can rename it, but not change its type.</p>
        )}
        <Field label="Account name" required error={errors.name}>
          {(p) => <Input {...p} name="name" defaultValue={initial?.name} required autoFocus />}
        </Field>
        <Field label="Account number" hint="Optional" error={errors.number}>
          {(p) => <Input {...p} name="number" defaultValue={initial?.number ?? ""} />}
        </Field>
        <Field label="Account type" error={errors.type}>
          {(p) => (
            <NativeSelect
              {...p}
              value={type}
              disabled={initial?.system}
              onChange={(e) => {
                const t = e.target.value as AccountType;
                setType(t);
                setDetail(DETAIL_TYPES[t][0]);
              }}
            >
              {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Detail type" error={errors.detailType}>
          {(p) => (
            <NativeSelect {...p} value={detail} onChange={(e) => setDetail(e.target.value)}>
              {DETAIL_TYPES[type].map((d) => (
                <option key={d} value={d}>
                  {humanize(d)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Make it a sub-account of" error={errors.parentId}>
          {(p) => (
            <NativeSelect {...p} name="parentId" defaultValue={initial?.parentId ?? ""}>
              <option value="">None (top level)</option>
              {parents
                .filter((a) => a.type === type && a.id !== initial?.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Description">{(p) => <Textarea {...p} name="description" defaultValue={initial?.description ?? ""} />}</Field>
        {isNew && BALANCE_SHEET_TYPES.has(type) && (
          <div className="grid grid-cols-2 gap-4 rounded-md border border-border p-3">
            <Field label="Opening balance" hint="As shown on your statement">
              {(p) => <MoneyInput {...p} value={opening} onValueChange={setOpening} />}
            </Field>
            <Field label="As of">{(p) => <Input {...p} type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />}</Field>
          </div>
        )}
      </form>
    </Drawer>
  );
}
