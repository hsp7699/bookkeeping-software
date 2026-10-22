"use client";

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import type { RuleCondition } from "@/lib/bank/rules";
import type { AccountType } from "@/lib/coa";
import { deleteRuleAction, moveRuleAction } from "../actions";
import { RuleDrawer, type RuleDraft } from "./rule-drawer";
import { Wand2 } from "lucide-react";

export interface RuleRow {
  id: string;
  name: string;
  priority: number;
  direction: "in" | "out" | "both";
  feed_account_ids: string[] | null;
  match_mode: "all" | "any";
  conditions: RuleCondition[];
  actions: NonNullable<RuleDraft["actions"]>;
  auto_confirm: boolean;
  pending: number;
  applied: number;
}

const OP: Record<string, string> = { contains: "contains", not_contains: "doesn't contain", equals: "is", gt: ">", lt: "<" };
const FIELD: Record<string, string> = { description: "Description", bank_text: "Bank text", amount: "Amount" };

export function RulesClient({
  companyId,
  rules,
  categories,
  contacts,
  feedAccounts,
}: {
  companyId: string;
  rules: RuleRow[];
  categories: { id: string; name: string; type: AccountType }[];
  contacts: { id: string; display_name: string; kind: string }[];
  feedAccounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing({ name: "", direction: "out", conditions: [{ field: "description", op: "contains", value: "" }] })}>
          <Plus className="size-4" aria-hidden /> New rule
        </Button>
      </div>
      {notice && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-on-success-soft">
          {notice}
        </p>
      )}
      <Card>
        {rules.length === 0 ? (
          <EmptyState icon={Wand2} title="No rules yet" body="Create a rule from any bank transaction, or here, and similar transactions get categorized for you." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Rule</Th>
                <Th>Conditions</Th>
                <Th>Records as</Th>
                <Th>Auto-add</Th>
                <Th numeric>Waiting</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="flex gap-1">
                      <button type="button" disabled={i === 0 || pending} aria-label={`Move ${r.name} up`} className="rounded-sm p-1 hover:bg-surface disabled:opacity-30" onClick={() => start(async () => { await moveRuleAction(companyId, r.id, -1); router.refresh(); })}>
                        <ArrowUp className="size-4" />
                      </button>
                      <button type="button" disabled={i === rules.length - 1 || pending} aria-label={`Move ${r.name} down`} className="rounded-sm p-1 hover:bg-surface disabled:opacity-30" onClick={() => start(async () => { await moveRuleAction(companyId, r.id, 1); router.refresh(); })}>
                        <ArrowDown className="size-4" />
                      </button>
                    </div>
                  </Td>
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="text-sm text-text-muted">
                    {r.direction === "in" ? "Money in" : r.direction === "out" ? "Money out" : "In or out"} ·{" "}
                    {r.conditions.map((c) => `${FIELD[c.field]} ${OP[c.op]} “${c.value}”`).join(r.match_mode === "all" ? " and " : " or ")}
                  </Td>
                  <Td className="text-sm">
                    {r.actions.txnType === "transfer" ? "Transfer" : r.actions.splits.map((s) => `${names.get(s.accountId) ?? "?"}${r.actions.splits.length > 1 ? ` ${(s.percentBp ?? 0) / 100}%` : ""}`).join(", ")}
                  </Td>
                  <Td>{r.auto_confirm ? "Yes" : "No"}</Td>
                  <Td numeric>{r.pending}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button
                      variant="link"
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          name: r.name,
                          direction: r.direction,
                          feedAccountIds: r.feed_account_ids,
                          matchMode: r.match_mode,
                          conditions: r.conditions,
                          actions: r.actions,
                          autoConfirm: r.auto_confirm,
                        })
                      }
                    >
                      Edit
                    </Button>{" "}
                    <Button variant="link" className="text-danger" onClick={() => start(async () => { await deleteRuleAction(companyId, r.id); router.refresh(); })}>
                      Delete
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && (
        <RuleDrawer
          companyId={companyId}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          categories={categories}
          contacts={contacts}
          feedAccounts={feedAccounts}
          initial={editing}
          onSaved={(n) => {
            setNotice(`Rule saved. ${n} ${n === 1 ? "transaction is" : "transactions are"} waiting with a suggestion from your rules.`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
