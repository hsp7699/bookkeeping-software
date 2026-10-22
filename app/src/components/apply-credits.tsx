"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { applyCreditAction, listCreditsAction } from "@/app/c/[companyId]/credit-actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TXN_LABEL } from "@/lib/routes";

/** On an open invoice or bill: the name's available credits, each with an Apply button. */
export function ApplyCredits({ companyId, docId, contactId, side, openCents }: { companyId: string; docId: string; contactId: string; side: "ar" | "ap"; openCents: number }) {
  const router = useRouter();
  const [credits, setCredits] = useState<{ id: string; type: string; number: string | null; txn_date: string; balance_cents: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    listCreditsAction(companyId, contactId, side).then(setCredits);
  }, [companyId, contactId, side, openCents]);
  if (credits.length === 0 || openCents <= 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-info-soft/40 p-4" aria-label="Credits available">
      <h3 className="font-semibold">Credits available</h3>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {credits.map((c) => {
          const amount = Math.min(c.balance_cents, openCents);
          const label = c.type === "payment" || c.type === "bill_payment" ? `Unapplied ${TXN_LABEL[c.type].toLowerCase()}` : TXN_LABEL[c.type];
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {label} {c.number} <span className="text-text-muted">· {formatDate(c.txn_date)} · {formatCents(c.balance_cents)} left</span>
              </span>
              <Button
                size="sm"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const res = await applyCreditAction(companyId, c.id, docId, amount);
                    if (!res.ok) return setError(res.error);
                    setError(null);
                    router.refresh();
                  })
                }
              >
                Apply {formatCents(amount)}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
