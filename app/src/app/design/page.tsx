"use client";

import { FileText, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, MoneyInput, NativeSelect } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCents } from "@/lib/money";

// Dev-only gallery of every primitive in every state. The design system check.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Card className="flex flex-wrap items-start gap-4 p-5">{children}</Card>
    </section>
  );
}

export default function DesignPage() {
  const [amount, setAmount] = useState<number | null>(123450);
  const [drawer, setDrawer] = useState(false);

  return (
    <main className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8 p-6">
      <h1 className="text-xl font-bold">Design system</h1>

      <Section title="Buttons">
        <Button variant="primary">Save and send</Button>
        <Button>Cancel</Button>
        <Button variant="ghost">Clear</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="link">View report</Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button variant="primary" size="sm">
          <Plus className="size-4" aria-hidden /> New
        </Button>
        <Button variant="primary" size="lg">
          Create invoice
        </Button>
      </Section>

      <Section title="Fields">
        <Field label="Customer" required className="w-64">
          {(p) => <Input {...p} placeholder="Choose a customer" />}
        </Field>
        <Field label="Email" error="Enter a valid email address" className="w-64">
          {(p) => <Input {...p} defaultValue="sam@" />}
        </Field>
        <Field label="Terms" hint="Due date is set from the invoice date" className="w-48">
          {(p) => (
            <NativeSelect {...p} defaultValue="net30">
              <option value="receipt">Due on receipt</option>
              <option value="net15">Net 15</option>
              <option value="net30">Net 30</option>
            </NativeSelect>
          )}
        </Field>
        <Field label="Amount" hint={`Stored as ${amount ?? "empty"} cents. Try =12*3`} className="w-48">
          {(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} />}
        </Field>
        <Field label="Disabled" className="w-48">
          {(p) => <Input {...p} disabled defaultValue="Locked" />}
        </Field>
      </Section>

      <Section title="Status pills">
        <StatusPill tone="overdue">Overdue 12 days</StatusPill>
        <StatusPill tone="due">Due in 3 days</StatusPill>
        <StatusPill tone="open">Open</StatusPill>
        <StatusPill tone="partial">Partially paid</StatusPill>
        <StatusPill tone="paid">Paid</StatusPill>
        <StatusPill tone="deposited">Deposited</StatusPill>
        <StatusPill tone="voided">Voided</StatusPill>
        <StatusPill tone="draft">Draft</StatusPill>
      </Section>

      <Section title="Table">
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>No.</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th numeric>Amount</Th>
            </tr>
          </thead>
          <tbody>
            <Tr>
              <Td>10/02/2026</Td>
              <Td>1041</Td>
              <Td>Harbor Coffee</Td>
              <Td>
                <StatusPill tone="paid">Paid</StatusPill>
              </Td>
              <Td numeric>{formatCents(185000)}</Td>
            </Tr>
            <Tr>
              <Td>10/09/2026</Td>
              <Td>1042</Td>
              <Td>Northside Dental</Td>
              <Td>
                <StatusPill tone="overdue">Overdue 3 days</StatusPill>
              </Td>
              <Td numeric>{formatCents(42999)}</Td>
            </Tr>
            <Tr>
              <Td>10/12/2026</Td>
              <Td>CM-7</Td>
              <Td>Harbor Coffee</Td>
              <Td>
                <StatusPill tone="open">Open</StatusPill>
              </Td>
              <Td numeric className="text-negative-amount">
                {formatCents(-5000)}
              </Td>
            </Tr>
          </tbody>
        </Table>
      </Section>

      <Section title="Empty state">
        <div className="w-full">
          <EmptyState
            icon={Users}
            title="No customers yet"
            body="Add the people and businesses you invoice."
            action={<Button variant="primary">Add customer</Button>}
          />
        </div>
      </Section>

      <Section title="Drawer">
        <Button onClick={() => setDrawer(true)}>
          <FileText className="size-4" aria-hidden /> Open drawer
        </Button>
        <Drawer
          open={drawer}
          onOpenChange={setDrawer}
          title="New customer"
          footer={
            <>
              <Button onClick={() => setDrawer(false)}>Cancel</Button>
              <Button variant="primary">Save</Button>
            </>
          }
        >
          <Field label="Display name" required>
            {(p) => <Input {...p} autoFocus />}
          </Field>
        </Drawer>
      </Section>
    </main>
  );
}
