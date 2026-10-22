"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RecurringDrawer, type RecurringValues } from "@/components/recurring-drawer";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { describeSchedule, type IntervalUnit } from "@/lib/recurring/schedule";
import { TXN_LABEL } from "@/lib/routes";
import { deleteRecurringAction, setRecurringActiveAction, createRecurringNowAction } from "./actions";

export interface RecurringRow {
  id: string;
  name: string;
  txn_type: string;
  mode: "scheduled" | "reminder";
  interval_unit: IntervalUnit;
  interval_count: number;
  day_of_month: number | null;
  next_date: string | null;
  end_date: string | null;
  auto_send: boolean;
  active: boolean;
  last_error: string | null;
  contact: string | null;
  memo: string | null;
  amount_cents: number;
  created_count: number;
}

export function RecurringTable({ companyId, rows, today }: { companyId: string; rows: RecurringRow[]; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RecurringValues | null>(null);
  const [deleting, setDeleting] = useState<RecurringRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (data: unknown) => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "That didn't work.");
      if (after) after(res.data);
      else router.refresh();
    });
  }

  return (
    <>
      {error && (
        <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
          {error}
        </p>
      )}
      <Table>
        <thead>
          <tr>
            <Th>Template</Th>
            <Th>Type</Th>
            <Th>Customer or vendor</Th>
            <Th>Schedule</Th>
            <Th>Next date</Th>
            <Th numeric>Amount</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ready = r.active && r.mode === "reminder" && r.next_date != null && r.next_date <= today;
            return (
              <Tr key={r.id} className={r.active ? undefined : "text-text-muted"}>
                <Td>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-sm text-text-muted">
                    {r.mode === "scheduled" ? (r.auto_send ? "Created and emailed automatically" : "Created automatically") : "Reminder"}
                    {r.created_count > 0 && ` · ${r.created_count} created`}
                  </span>
                  {r.last_error && (
                    <span className="block text-sm text-danger" role="note">
                      Last run failed: {r.last_error}
                    </span>
                  )}
                </Td>
                <Td>{TXN_LABEL[r.txn_type]}</Td>
                <Td>{r.contact ?? ""}</Td>
                <Td>{describeSchedule({ unit: r.interval_unit, count: r.interval_count, dayOfMonth: r.day_of_month })}</Td>
                <Td>
                  {!r.active ? (
                    <StatusPill tone="draft">Paused</StatusPill>
                  ) : r.next_date ? (
                    <>
                      {formatDate(r.next_date)} {ready && <StatusPill tone="due">Ready</StatusPill>}
                    </>
                  ) : (
                    <StatusPill tone="voided">Ended</StatusPill>
                  )}
                </Td>
                <Td numeric>{formatCents(r.amount_cents)}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`Actions for ${r.name}`} disabled={pending}>
                        {ready ? "Create now" : "Actions"} <ChevronDown className="size-4" aria-hidden />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content align="end" className="z-50 min-w-40 rounded-md border border-border bg-bg py-1 shadow-pop">
                        {[
                          { label: "Create now", onSelect: () => run(() => createRecurringNowAction(companyId, r.id), (d) => router.push((d as { href: string }).href)) },
                          {
                            label: "Edit schedule",
                            onSelect: () =>
                              setEditing({
                                id: r.id,
                                txnType: r.txn_type,
                                name: r.name,
                                mode: r.mode,
                                intervalUnit: r.interval_unit,
                                intervalCount: r.interval_count,
                                dayOfMonth: r.day_of_month,
                                nextDate: r.next_date ?? today,
                                endDate: r.end_date,
                                autoSend: r.auto_send,
                              }),
                          },
                          r.active
                            ? { label: "Pause", onSelect: () => run(() => setRecurringActiveAction(companyId, r.id, false)) }
                            : { label: "Resume", onSelect: () => run(() => setRecurringActiveAction(companyId, r.id, true)) },
                          { label: "Delete", danger: true, onSelect: () => setDeleting(r) },
                        ].map((m) => (
                          <Menu.Item
                            key={m.label}
                            onSelect={m.onSelect}
                            className={`cursor-pointer px-3 py-1.5 outline-none data-[highlighted]:bg-row-hover ${"danger" in m ? "text-danger" : ""}`}
                          >
                            {m.label}
                          </Menu.Item>
                        ))}
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {editing && <RecurringDrawer companyId={companyId} open onOpenChange={(o) => !o && setEditing(null)} initial={editing} />}
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        body="Nothing more will be created from it. Transactions it already created stay in your books."
        confirmLabel="Delete"
        destructive
        pending={pending}
        onConfirm={() => run(() => deleteRecurringAction(companyId, deleting!.id), () => { setDeleting(null); router.refresh(); })}
      />
    </>
  );
}
