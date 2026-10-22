"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Textarea } from "@/components/ui/field";
import { emailStatementAction } from "./actions";

export function EmailStatement({
  companyId,
  customerId,
  params,
  emails,
  text,
  mailReady,
}: {
  companyId: string;
  customerId: string;
  params: { kind: string; from: string; to: string };
  emails: string[];
  text: { subject: string; body: string };
  mailReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(emails.join(", "));
  const [subject, setSubject] = useState(text.subject);
  const [body, setBody] = useState(text.body);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="primary" onClick={() => { setSent(false); setError(null); setOpen(true); }}>
        Email statement
      </Button>
      {sent && (
        <p role="status" className="self-center text-sm text-on-success-soft">
          Statement sent.
        </p>
      )}
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Email statement"
        description="The statement goes as a PDF attachment."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await emailStatementAction(companyId, customerId, { ...params, to_emails: to.split(/[,\s;]+/).filter(Boolean), subject, body });
                  if (!res.ok) return setError(res.error);
                  setSent(true);
                  setOpen(false);
                })
              }
            >
              Send
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {!mailReady && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-on-warning-soft">Email isn&apos;t set up on this server yet. Download the PDF and send it yourself, or add SMTP settings to the server.</p>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
              {error}
            </p>
          )}
          <Field label="To" hint="Separate addresses with commas.">
            {(p) => <Input {...p} value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
          <Field label="Subject">{(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
          <Field label="Message">{(p) => <Textarea {...p} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        </div>
      </Drawer>
    </>
  );
}
