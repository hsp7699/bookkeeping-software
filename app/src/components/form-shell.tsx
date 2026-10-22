"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Field, Input } from "@/components/ui/field";

/** Full-page transaction form frame: title bar, scroll body, sticky action bar, Ctrl/Cmd+S. */
export function FormShell({
  title,
  status,
  closeHref,
  error,
  closePassword,
  onClosePassword,
  left,
  right,
  saveId,
  children,
}: {
  title: string;
  status?: React.ReactNode;
  closeHref: string;
  error: string | null;
  closePassword?: string | null;
  onClosePassword?: (v: string) => void;
  left: React.ReactNode;
  right: React.ReactNode;
  saveId: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        document.getElementById(saveId)?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveId]);
  return (
    <div className="-m-6 flex min-h-[calc(100dvh-var(--header-height))] flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{title}</h1>
          {status}
        </div>
        <Link href={closeHref} className="rounded-sm p-1 text-text-muted hover:bg-row-hover" aria-label="Close">
          <X className="size-5" />
        </Link>
      </div>
      <div className="flex-1 px-6 py-6">
        {error && (
          <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        {closePassword != null && onClosePassword && (
          <Field label="Close-books password" className="mb-4 max-w-sm">
            {(p) => <Input {...p} type="password" value={closePassword} onChange={(e) => onClosePassword(e.target.value)} />}
          </Field>
        )}
        {children}
      </div>
      <div className="sticky bottom-0 flex h-[var(--form-action-bar-height)] items-center justify-between gap-2 border-t border-border bg-bg px-6">
        <div className="flex gap-2">{left}</div>
        <div className="flex gap-2">{right}</div>
      </div>
    </div>
  );
}
