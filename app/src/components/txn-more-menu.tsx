"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTransactionAction, voidTransactionAction } from "@/app/c/[companyId]/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { RecurringDrawer, type RecurringValues } from "@/components/recurring-drawer";
import { nextOccurrence, RECURRING_TYPES } from "@/lib/recurring/schedule";

interface Extra {
  label: string;
  onSelect: () => void;
}

/** "More" menu on a saved transaction: void, delete, plus form-specific items. */
export function TxnMoreMenu({
  companyId,
  txnId,
  label,
  voided,
  afterDelete,
  extra = [],
  recur,
}: {
  companyId: string;
  txnId: string;
  label: string;
  voided?: boolean;
  afterDelete: string;
  extra?: Extra[];
  /** offer "Make recurring" for this saved transaction */
  recur?: { txnType: string; txnDate: string; name: string };
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"void" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [recurOpen, setRecurOpen] = useState(false);
  const canRecur = recur && !voided && (RECURRING_TYPES as readonly string[]).includes(recur.txnType);

  function run() {
    start(async () => {
      const fn = confirm === "void" ? voidTransactionAction : deleteTransactionAction;
      const res = await fn(companyId, txnId, needsPassword ? password : undefined);
      if (!res.ok) {
        setError(res.error);
        if (res.error.includes("closed period") || res.error.includes("close-books password")) setNeedsPassword(true);
        return;
      }
      setConfirm(null);
      if (confirm === "delete") router.push(afterDelete);
      router.refresh();
    });
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost">
            More <ChevronUp className="size-4" aria-hidden />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content side="top" align="start" className="z-50 min-w-44 rounded-md border border-border bg-bg py-1 shadow-pop">
            {extra.map((e) => (
              <Menu.Item key={e.label} onSelect={e.onSelect} className="cursor-pointer px-3 py-1.5 outline-none data-[highlighted]:bg-row-hover">
                {e.label}
              </Menu.Item>
            ))}
            {canRecur && (
              <Menu.Item onSelect={() => setRecurOpen(true)} className="cursor-pointer px-3 py-1.5 outline-none data-[highlighted]:bg-row-hover">
                Make recurring
              </Menu.Item>
            )}
            {!voided && (
              <Menu.Item onSelect={() => { setError(null); setConfirm("void"); }} className="cursor-pointer px-3 py-1.5 outline-none data-[highlighted]:bg-row-hover">
                Void
              </Menu.Item>
            )}
            <Menu.Item onSelect={() => { setError(null); setConfirm("delete"); }} className="cursor-pointer px-3 py-1.5 text-danger outline-none data-[highlighted]:bg-row-hover">
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <ConfirmDialog
        open={confirm != null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "void" ? `Void this ${label}?` : `Delete this ${label}?`}
        body={
          confirm === "void"
            ? "It stays in your records with its number, but every amount becomes zero and nothing posts to your books."
            : "It's removed from your books entirely. This can't be undone, but the audit log keeps a copy."
        }
        confirmLabel={confirm === "void" ? "Void" : "Delete"}
        destructive
        pending={pending}
        onConfirm={run}
      >
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
            {error}
          </p>
        )}
        {needsPassword && (
          <div className="mt-3">
            <label className="text-sm font-medium" htmlFor="close-pw">
              Close-books password
            </label>
            <Input id="close-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
      </ConfirmDialog>
      {canRecur && <RecurringDrawer companyId={companyId} open={recurOpen} onOpenChange={setRecurOpen} initial={recurDefaults(txnId, recur)} />}
    </>
  );
}

/** Monthly from the transaction's date, starting with the next date that hasn't passed. */
function recurDefaults(txnId: string, r: { txnType: string; txnDate: string; name: string }): RecurringValues {
  const day = Number(r.txnDate.slice(8));
  const [y, m] = r.txnDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const sched = { unit: "month" as const, count: 1, dayOfMonth: day === lastDay ? 31 : Math.min(day, 28) };
  const today = new Date().toLocaleDateString("en-CA");
  let next = nextOccurrence(r.txnDate, sched);
  while (next < today) next = nextOccurrence(next, sched);
  return { txnId, txnType: r.txnType, name: r.name, mode: "scheduled", intervalUnit: "month", intervalCount: 1, dayOfMonth: sched.dayOfMonth, nextDate: next, endDate: null, autoSend: false };
}
