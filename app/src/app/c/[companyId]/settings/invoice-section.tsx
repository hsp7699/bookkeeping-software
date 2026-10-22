"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/table";
import { saveInvoiceAppearanceAction, saveRemindersAction } from "./invoice-actions";

export interface InvoiceDefaults {
  accent?: string;
  footer?: string | null;
  showQtyRate?: boolean;
  logoAttachmentId?: string | null;
  reminders?: { enabled: boolean; days: number[] };
}

function Notice({ ok, error }: { ok: string | null; error: string | null }) {
  if (error)
    return (
      <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
        {error}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="mt-3 rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
        {ok}
      </p>
    );
  return null;
}

export function InvoiceAppearanceSection({ companyId, d, sampleInvoiceId }: { companyId: string; d: InvoiceDefaults; sampleInvoiceId: string | null }) {
  const router = useRouter();
  const [accent, setAccent] = useState(d.accent ?? "#161a20");
  const [footer, setFooter] = useState(d.footer ?? "");
  const [showQtyRate, setShowQtyRate] = useState(d.showQtyRate ?? true);
  const [logo, setLogo] = useState<string | null>(d.logoAttachmentId ?? null);
  const [uploading, setUploading] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(f: File) {
    setError(null);
    if (!["image/png", "image/jpeg"].includes(f.type)) return setError("Use a PNG or JPEG for the logo.");
    if (f.size > 2 * 1024 * 1024) return setError("Logos can be up to 2 MB.");
    setUploading(true);
    const body = new FormData();
    body.set("file", f);
    const res = await fetch(`/c/${companyId}/attachments`, { method: "POST", body });
    setUploading(false);
    const j = await res.json();
    if (!res.ok) return setError(j.error ?? "Upload failed.");
    setLogo(j.id);
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Invoice appearance</h2>
      <p className="mt-1 mb-4 text-text-muted">How invoices, estimates and sales receipts look as PDFs and email attachments.</p>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOk(null);
          start(async () => {
            const res = await saveInvoiceAppearanceAction(companyId, { accent, footer, showQtyRate, logoAttachmentId: logo });
            if (!res.ok) return setError(res.error);
            setError(null);
            setOk("Saved. New PDFs use this look.");
            router.refresh();
          });
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Logo</span>
          <div className="flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- private file behind auth, not optimisable
              <img src={`/c/${companyId}/attachments/${logo}`} alt="Your logo" className="h-14 max-w-40 rounded-sm border border-border object-contain p-1" />
            ) : (
              <span className="flex h-14 w-28 items-center justify-center rounded-sm border border-dashed border-border-input text-sm text-text-muted">No logo</span>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Upload logo" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button onClick={() => fileRef.current?.click()} loading={uploading}>
              {logo ? "Replace" : "Upload"}
            </Button>
            {logo && (
              <Button variant="ghost" onClick={() => setLogo(null)}>
                Remove
              </Button>
            )}
          </div>
          <span className="text-sm text-text-muted">PNG or JPEG, up to 2 MB.</span>
        </div>
        <Field label="Accent colour" hint="Used for the title, the total line and the balance due.">
          {(p) => (
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Accent colour picker" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-12 cursor-pointer rounded-sm border border-border-input" />
              <Input {...p} value={accent} onChange={(e) => setAccent(e.target.value)} className="max-w-32 font-mono" maxLength={7} />
            </div>
          )}
        </Field>
        <Field label="Footer" hint="Printed at the bottom of every page: payment instructions, a thank-you, your licence number." className="md:col-span-2">
          {(p) => <Textarea {...p} value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={300} />}
        </Field>
        <label className="flex items-center gap-2 md:col-span-2">
          <input type="checkbox" checked={showQtyRate} onChange={(e) => setShowQtyRate(e.target.checked)} />
          Show quantity and rate columns
        </label>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" variant="primary" loading={pending}>
            Save appearance
          </Button>
          {sampleInvoiceId && (
            <Button asChild variant="ghost">
              <a href={`/c/${companyId}/invoices/${sampleInvoiceId}/pdf`} target="_blank" rel="noreferrer">
                Preview on your latest invoice
              </a>
            </Button>
          )}
        </div>
      </form>
      <Notice ok={ok} error={error} />
    </Card>
  );
}

export function RemindersSection({ companyId, d, mailReady }: { companyId: string; d: InvoiceDefaults; mailReady: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(d.reminders?.enabled ?? false);
  const [days, setDays] = useState((d.reminders?.days ?? [3, 14, 30]).join(", "));
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Overdue reminders</h2>
      <p className="mt-1 mb-4 text-text-muted">Email customers a copy of an unpaid invoice a set number of days after it&apos;s due. Each step is sent once per invoice.</p>
      {!mailReady && (
        <p className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-on-warning-soft">
          Email isn&apos;t set up on this server yet, so nothing will be sent. Add SMTP_URL and MAIL_FROM to the server&apos;s .env.
        </p>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setOk(null);
          const list = days
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number);
          if (list.some((n) => !Number.isInteger(n))) return setError("Enter whole numbers of days, separated by commas.");
          start(async () => {
            const res = await saveRemindersAction(companyId, { enabled, days: list });
            if (!res.ok) return setError(res.error);
            setError(null);
            setOk(enabled ? "Reminders are on." : "Reminders are off.");
            router.refresh();
          });
        }}
      >
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send overdue reminders automatically
        </label>
        <Field label="Days after the due date" hint="Up to 5, separated by commas. For example: 3, 14, 30">
          {(p) => <Input {...p} value={days} onChange={(e) => setDays(e.target.value)} className="max-w-xs" disabled={!enabled} />}
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={pending}>
            Save reminders
          </Button>
        </div>
      </form>
      <Notice ok={ok} error={error} />
    </Card>
  );
}
