"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { sendInvoiceAction } from "./email-actions";

export function EmailInvoiceDialog({
  companyId,
  invoiceId,
  number,
  defaultTo,
  open,
  onOpenChange,
}: {
  companyId: string;
  invoiceId: string;
  number: string | null;
  defaultTo: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(`Invoice ${number ?? ""}`.trim());
  const [body, setBody] = useState(`Hello,\n\nYour invoice ${number ?? ""} is attached. Thank you for your business.\n`);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setSent(false); setError(null); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg bg-bg p-6 shadow-pop">
          <Dialog.Title className="text-lg font-semibold">Email invoice {number}</Dialog.Title>
          <Dialog.Description className="text-text-muted">The invoice goes as a PDF attachment.</Dialog.Description>
          {sent ? (
            <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
              Sent to {to}.
            </p>
          ) : (
            <>
              {error && (
                <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
                  {error}
                </p>
              )}
              <Field label="To" hint="Separate several addresses with commas.">
                {(p) => <Input {...p} value={to} onChange={(e) => setTo(e.target.value)} />}
              </Field>
              <Field label="Subject">{(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
              <Field label="Message">{(p) => <Textarea {...p} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
            </>
          )}
          <div className="flex justify-between gap-2">
            <Button asChild variant="ghost">
              <a href={`/c/${companyId}/invoices/${invoiceId}/pdf`} target="_blank" rel="noreferrer">
                Preview PDF
              </a>
            </Button>
            <div className="flex gap-2">
              <Button onClick={() => onOpenChange(false)}>{sent ? "Close" : "Cancel"}</Button>
              {!sent && (
                <Button
                  variant="primary"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await sendInvoiceAction(companyId, invoiceId, {
                        to: to.split(",").map((s) => s.trim()).filter(Boolean),
                        subject,
                        body,
                      });
                      if (!res.ok) setError(res.error);
                      else setSent(true);
                    })
                  }
                >
                  Send
                </Button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
