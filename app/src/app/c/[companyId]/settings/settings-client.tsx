"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { Card } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { addTaxRateAction, saveCompanySettingsAction, setCloseDateAction } from "./actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TIMEZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
];

export interface CompanySettings {
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  ein: string | null;
  address: { line1?: string; line2?: string; city?: string; state?: string; zip?: string };
  fiscal_year_start_month: number;
  accounting_method: "accrual" | "cash";
  timezone: string;
  close_date: string | null;
  has_close_password: boolean;
}

function Notice({ ok, error }: { ok: string | null; error: string | null }) {
  if (error)
    return (
      <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
        {error}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
        {ok}
      </p>
    );
  return null;
}

export function CompanySection({ companyId, c }: { companyId: string; c: CompanySettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Company</h2>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const s = (k: string) => String(f.get(k) ?? "");
          start(async () => {
            const res = await saveCompanySettingsAction(companyId, {
              name: s("name"),
              legalName: s("legalName"),
              email: s("email"),
              phone: s("phone"),
              ein: s("ein"),
              address: { line1: s("line1"), line2: s("line2"), city: s("city"), state: s("state"), zip: s("zip") },
              fiscalYearStartMonth: s("fy"),
              accountingMethod: s("method"),
              timezone: s("tz"),
            });
            setOk(res.ok ? "Saved." : null);
            setError(res.ok ? null : res.error);
            router.refresh();
          });
        }}
      >
        <div className="sm:col-span-2">
          <Notice ok={ok} error={error} />
        </div>
        <Field label="Business name">{(p) => <Input {...p} name="name" defaultValue={c.name} required />}</Field>
        <Field label="Legal name" hint="If different, shown on tax forms">
          {(p) => <Input {...p} name="legalName" defaultValue={c.legal_name ?? ""} />}
        </Field>
        <Field label="Email" hint="Customers reply to this address">
          {(p) => <Input {...p} name="email" type="email" defaultValue={c.email ?? ""} />}
        </Field>
        <Field label="Phone">{(p) => <Input {...p} name="phone" defaultValue={c.phone ?? ""} />}</Field>
        <Field label="EIN">{(p) => <Input {...p} name="ein" defaultValue={c.ein ?? ""} />}</Field>
        <fieldset className="flex flex-col gap-3 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Address (printed on invoices)</legend>
          <Input name="line1" aria-label="Street address" placeholder="Street address" defaultValue={c.address.line1} />
          <Input name="line2" aria-label="Address line 2" placeholder="Suite, unit (optional)" defaultValue={c.address.line2} />
          <div className="grid grid-cols-[1fr_5rem_7rem] gap-3">
            <Input name="city" aria-label="City" placeholder="City" defaultValue={c.address.city} />
            <Input name="state" aria-label="State" placeholder="State" defaultValue={c.address.state} />
            <Input name="zip" aria-label="ZIP code" placeholder="ZIP" defaultValue={c.address.zip} />
          </div>
        </fieldset>
        <Field label="First month of fiscal year">
          {(p) => (
            <NativeSelect {...p} name="fy" defaultValue={String(c.fiscal_year_start_month)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Default report basis">
          {(p) => (
            <NativeSelect {...p} name="method" defaultValue={c.accounting_method}>
              <option value="accrual">Accrual</option>
              <option value="cash">Cash</option>
            </NativeSelect>
          )}
        </Field>
        <Field label="Time zone">
          {(p) => (
            <NativeSelect {...p} name="tz" defaultValue={c.timezone}>
              {TIMEZONES.map(([z, l]) => (
                <option key={z} value={z}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <div className="flex items-end justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            Save company settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function CloseBooksSection({ companyId, c }: { companyId: string; c: CompanySettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState(c.close_date ?? "");
  const [password, setPassword] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Close the books</h2>
      <p className="mt-1 mb-4 text-text-muted">
        Lock everything dated on or before a date, so filed numbers can&apos;t change by accident. Changing a closed period needs the password and is recorded in the audit log.
      </p>
      <div className="flex flex-col gap-4">
        <Notice ok={ok} error={error} />
        {c.close_date && (
          <p>
            Books are closed through <strong>{formatDate(c.close_date)}</strong>.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Closing date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label={c.has_close_password ? "New password (optional)" : "Password"}>
            {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
          </Field>
          <div className="flex items-end gap-2">
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await setCloseDateAction(companyId, { closeDate: date, password: password || undefined });
                  setOk(res.ok ? (date ? "Books closed." : "Books reopened.") : null);
                  setError(res.ok ? null : res.error);
                  setPassword("");
                  router.refresh();
                })
              }
            >
              Save closing date
            </Button>
            {c.close_date && (
              <Button
                onClick={() =>
                  start(async () => {
                    const res = await setCloseDateAction(companyId, { closeDate: "" });
                    setDate("");
                    setOk(res.ok ? "Books reopened." : null);
                    router.refresh();
                  })
                }
              >
                Reopen
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function TaxRatesSection({ companyId, rates }: { companyId: string; rates: { id: string; name: string; agency: string; rate_bp: number }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Sales tax rates</h2>
      <p className="mt-1 mb-4 text-text-muted">Rates you charge on invoices and sales receipts. Tax collected goes to Sales Tax Payable.</p>
      {rates.length > 0 && (
        <ul className="mb-4 divide-y divide-border rounded-md border border-border">
          {rates.map((r) => (
            <li key={r.id} className="flex justify-between px-3 py-2">
              <span>
                {r.name} <span className="text-text-muted">· {r.agency}</span>
              </span>
              <span className="num">{(r.rate_bp / 100).toFixed(2)}%</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          start(async () => {
            const res = await addTaxRateAction(companyId, { name: f.get("name"), agency: f.get("agency"), ratePercent: f.get("rate") });
            if (!res.ok) return setError(res.error);
            setError(null);
            form.reset();
            router.refresh();
          });
        }}
      >
        <Field label="Rate name">{(p) => <Input {...p} name="name" placeholder="Portland combined" required />}</Field>
        <Field label="Tax agency">{(p) => <Input {...p} name="agency" placeholder="Oregon DOR" required />}</Field>
        <Field label="Rate (%)">{(p) => <Input {...p} name="rate" inputMode="decimal" placeholder="8.25" required />}</Field>
        <div className="flex items-end">
          <Button type="submit" loading={pending}>
            Add rate
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
