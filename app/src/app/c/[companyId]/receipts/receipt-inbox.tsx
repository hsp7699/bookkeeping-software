"use client";

import { FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, MoneyInput, NativeSelect } from "@/components/ui/field";
import { Card } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { ReceiptMatch } from "@/lib/receipts";
import { TXN_LABEL } from "@/lib/routes";
import { addReceiptsAction, createExpenseFromReceiptAction, deleteReceiptAction, matchReceiptAction, updateReceiptAction } from "./actions";

export interface ReceiptRow {
  id: string;
  attachment_id: string;
  file_name: string;
  content_type: string;
  vendor_name: string | null;
  txn_date: string | null;
  amount_cents: number | null;
  matches: ReceiptMatch[];
}

type Opt = { id: string; name: string };

export function ReceiptInbox({ companyId, rows, payAccounts, categories, vendors }: { companyId: string; rows: ReceiptRow[]; payAccounts: Opt[]; categories: Opt[]; vendors: string[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList) {
    setError(null);
    setUploading(true);
    const ids: string[] = [];
    for (const f of Array.from(files)) {
      const body = new FormData();
      body.set("file", f);
      const res = await fetch(`/c/${companyId}/attachments`, { method: "POST", body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(`${f.name}: ${j.error ?? "upload failed"}`);
      else ids.push(j.id);
    }
    if (ids.length) {
      const res = await addReceiptsAction(companyId, ids);
      if (res.ok && res.data.added < ids.length) setError("Only PDFs and photos can be receipts. Other files were skipped.");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input ref={fileRef} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/heic,image/webp" className="sr-only" aria-label="Upload receipts" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
        <Button variant="primary" loading={uploading} onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" aria-hidden /> Upload receipts
        </Button>
        <span className="text-sm text-text-muted">PDFs or photos, up to 25 MB each.</span>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="No receipts waiting" body="Upload a receipt and it waits here until you attach it to a transaction or record it as an expense." />
        </Card>
      ) : (
        <datalist id="receipt-vendors">
          {vendors.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}
      {rows.map((r) => (
        <ReceiptCard key={r.id} companyId={companyId} r={r} payAccounts={payAccounts} categories={categories} />
      ))}
    </div>
  );
}

function ReceiptCard({ companyId, r, payAccounts, categories }: { companyId: string; r: ReceiptRow; payAccounts: Opt[]; categories: Opt[] }) {
  const router = useRouter();
  const [vendor, setVendor] = useState(r.vendor_name ?? "");
  const [date, setDate] = useState(r.txn_date ?? "");
  const [amount, setAmount] = useState<number | null>(r.amount_cents);
  const [pay, setPay] = useState(payAccounts[0]?.id ?? "");
  const [cat, setCat] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const src = `/c/${companyId}/attachments/${r.attachment_id}`;
  const isImage = r.content_type.startsWith("image/") && r.content_type !== "image/heic";

  const saveDetails = (next: { vendorName?: string; txnDate?: string; amountCents?: number | null }) =>
    start(async () => {
      await updateReceiptAction(companyId, r.id, { vendorName: vendor, txnDate: date, amountCents: amount, ...next });
      router.refresh();
    });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "That didn't work.");
      router.refresh();
    });

  return (
    <Card role="group" className="flex flex-col gap-4 p-4 md:flex-row" aria-label={`Receipt ${r.file_name}`}>
      <a href={src} target="_blank" rel="noreferrer" className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface md:w-32">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- private file behind auth
          <img src={src} alt={`Receipt ${r.file_name}`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 p-2 text-center text-sm text-text-muted">
            <FileText className="size-8" aria-hidden /> {r.file_name}
          </span>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Vendor">
            {(p) => <Input {...p} list="receipt-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} onBlur={() => vendor !== (r.vendor_name ?? "") && saveDetails({ vendorName: vendor })} />}
          </Field>
          <Field label="Date">
            {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => date !== (r.txn_date ?? "") && saveDetails({ txnDate: date })} />}
          </Field>
          <Field label="Amount">
            {(p) => (
              <MoneyInput
                {...p}
                value={amount}
                onValueChange={(v) => {
                  setAmount(v);
                  if (v !== r.amount_cents) saveDetails({ amountCents: v });
                }}
              />
            )}
          </Field>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        {r.matches.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Looks like</p>
            {r.matches.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {TXN_LABEL[m.type]}
                  {m.number ? ` ${m.number}` : ""}
                  {m.contact ? ` · ${m.contact}` : ""} · {formatDate(m.txn_date)} · {formatCents(m.total_cents)}
                </span>
                <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => matchReceiptAction(companyId, r.id, m.id))}>
                  Attach
                </Button>
              </div>
            ))}
          </div>
        )}
        {creating ? (
          <div className="grid gap-3 rounded-md bg-surface p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Paid from">
              {(p) => (
                <NativeSelect {...p} value={pay} onChange={(e) => setPay(e.target.value)}>
                  {payAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Category">
              {(p) => (
                <NativeSelect {...p} value={cat} onChange={(e) => setCat(e.target.value)}>
                  <option value="">Choose a category</option>
                  {categories.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => run(() => createExpenseFromReceiptAction(companyId, r.id, { vendorName: vendor, txnDate: date, amountCents: amount, paymentAccountId: pay, categoryAccountId: cat }))}
            >
              Save expense
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!creating && (
            <Button size="sm" onClick={() => setCreating(true)}>
              Create expense
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link href={src} target="_blank">
              Open file
            </Link>
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => run(() => deleteReceiptAction(companyId, r.id))}>
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
