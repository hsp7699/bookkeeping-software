"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { createCompanyAction } from "../actions";
import { AuthCard, FormError } from "../auth-card";

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

export default function SetupPage() {
  const [state, action, pending] = useActionState(createCompanyAction, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <AuthCard title="Set up your business">
      <form action={action} className="flex flex-col gap-4">
        <FormError message={state?.error} />
        <Field label="Business name" error={fe.name}>
          {(p) => <Input {...p} name="name" required autoFocus />}
        </Field>
        <Field label="Business type" hint="Sets up the right equity accounts. You can change accounts later." error={fe.entityType}>
          {(p) => (
            <NativeSelect {...p} name="entityType" defaultValue="llc_single">
              <option value="sole_prop">Sole proprietor</option>
              <option value="llc_single">Single-member LLC</option>
              <option value="llc_multi">Multi-member LLC</option>
              <option value="partnership">Partnership</option>
              <option value="s_corp">S corporation</option>
              <option value="c_corp">C corporation</option>
              <option value="nonprofit">Nonprofit</option>
            </NativeSelect>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fiscal year starts" error={fe.fiscalYearStartMonth}>
            {(p) => (
              <NativeSelect {...p} name="fiscalYearStartMonth" defaultValue="1">
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Accounting method" error={fe.accountingMethod}>
            {(p) => (
              <NativeSelect {...p} name="accountingMethod" defaultValue="accrual">
                <option value="accrual">Accrual</option>
                <option value="cash">Cash</option>
              </NativeSelect>
            )}
          </Field>
        </div>
        <Field label="Time zone" hint="Decides when invoices become overdue.">
          {(p) => (
            <NativeSelect {...p} name="timezone" defaultValue="America/New_York">
              {TIMEZONES.map(([z, label]) => (
                <option key={z} value={z}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Create company
        </Button>
      </form>
    </AuthCard>
  );
}
