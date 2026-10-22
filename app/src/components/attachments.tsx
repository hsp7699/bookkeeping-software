"use client";

import { Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteAttachmentAction, listAttachmentsAction } from "@/app/c/[companyId]/attachments/actions";
import { cn } from "@/lib/cn";

type Item = { id: string; file_name: string; size_bytes: number };

function size(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

/** Drag-drop or click to attach files to a saved transaction. */
export function Attachments({ companyId, txnId }: { companyId: string; txnId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reload = useCallback(() => listAttachmentsAction(companyId, txnId).then(setItems), [companyId, txnId]);
  useEffect(() => {
    reload();
  }, [reload]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("txnId", txnId);
      const res = await fetch(`/c/${companyId}/attachments`, { method: "POST", body: fd });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Upload failed.");
    }
    setBusy(false);
    reload();
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Attachments</span>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files);
        }}
        className={cn("flex items-center justify-center gap-2 rounded-md border border-dashed border-border-input px-3 py-4 text-text-muted", over && "bg-accent-soft text-on-accent-soft")}
      >
        <Paperclip className="size-4" aria-hidden /> {busy ? "Uploading…" : "Drop files here or click to attach (up to 25 MB)"}
      </button>
      <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.csv" onChange={(e) => upload(e.target.files)} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 hover:bg-row-hover">
              <a className="truncate text-accent hover:underline" href={`/c/${companyId}/attachments/${a.id}`} target="_blank" rel="noreferrer">
                {a.file_name}
              </a>
              <span className="flex items-center gap-2 text-sm text-text-muted">
                {size(a.size_bytes)}
                <button
                  type="button"
                  aria-label={`Remove ${a.file_name}`}
                  className="rounded-sm p-1 hover:bg-surface hover:text-danger"
                  onClick={async () => {
                    await deleteAttachmentAction(companyId, a.id);
                    reload();
                  }}
                >
                  <X className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
