import "server-only";
import { one, query } from "@/db";
import { aging } from "@/lib/reports/statements";
import { TXN_LABEL } from "@/lib/routes";

// Customer statements. Two kinds, like most small-business tools:
//  - balance forward: the balance at the start, every A/R movement in the range, a running balance
//  - open item: the invoices still unpaid on the statement date, with aging

export type StatementKind = "balance_forward" | "open_item";

export interface StatementRow {
  id: string;
  date: string;
  label: string; // "Invoice 1004"
  dueDate: string | null;
  amountCents: number;
  balanceCents: number; // running (balance forward) or still open (open item)
}

export interface Statement {
  kind: StatementKind;
  from: string;
  to: string;
  company: { name: string; address: Record<string, string>; email: string | null; phone: string | null };
  customer: { id: string; name: string; address: Record<string, string>; emails: string[] };
  openingCents: number;
  rows: StatementRow[];
  closingCents: number;
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d91: number };
  brand: { accent: string; footer: string | null; logoAttachmentId: string | null };
}

export async function loadStatement(companyId: string, customerId: string, kind: StatementKind, from: string, to: string): Promise<Statement | null> {
  const head = await one<{
    company_name: string;
    company_address: Record<string, string>;
    company_email: string | null;
    company_phone: string | null;
    name: string;
    address: Record<string, string>;
    emails: string[];
    d: { accent?: string; footer?: string | null; logoAttachmentId?: string | null };
  }>(
    `select co.name as company_name, co.address as company_address, co.email as company_email, co.phone as company_phone,
            c.display_name as name, c.billing_address as address, c.emails::text[] as emails, co.invoice_defaults as d
     from contacts c join companies co on co.id = c.company_id where c.company_id = $1 and c.id = $2 and c.kind = 'customer'`,
    [companyId, customerId],
  );
  if (!head) return null;

  const label = (type: string, number: string | null) => `${TXN_LABEL[type] ?? type}${number ? ` ${number}` : ""}`;
  const ag = await aging(companyId, "ar", to);
  const mine = ag.detail.filter((d) => d.contact_id === customerId);
  const bucket = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91: 0 };
  for (const d of mine) {
    const b = d.open < 0 || d.type !== "invoice" || d.days === 0 ? "current" : d.days <= 30 ? "d1_30" : d.days <= 60 ? "d31_60" : d.days <= 90 ? "d61_90" : "d91";
    bucket[b] += d.open;
  }

  let rows: StatementRow[];
  let opening = 0;
  if (kind === "open_item") {
    rows = mine.map((d) => ({ id: d.id, date: d.txn_date, label: label(d.type, d.number), dueDate: d.type === "invoice" ? d.due_date : null, amountCents: d.open, balanceCents: d.open }));
  } else {
    const ar = `select l.transaction_id, l.entry_date, l.debit_cents - l.credit_cents as net
                from ledger_entries l join accounts a on a.id = l.account_id
                where l.company_id = $1 and l.contact_id = $2 and a.system_role = 'accounts_receivable'`;
    opening = Number((await one<{ s: string }>(`select coalesce(sum(net), 0) as s from (${ar}) x where entry_date < $3`, [companyId, customerId, from]))!.s);
    const moves = await query<{ id: string; date: string; type: string; number: string | null; due_date: string | null; net: string }>(
      `select t.id, x.entry_date::text as date, t.type, t.number, t.due_date::text, sum(x.net) as net
       from (${ar}) x join transactions t on t.id = x.transaction_id
       where x.entry_date between $3 and $4
       group by t.id, x.entry_date, t.type, t.number, t.due_date, t.created_at having sum(x.net) <> 0
       order by x.entry_date, t.created_at`,
      [companyId, customerId, from, to],
    );
    let run = opening;
    rows = moves.map((m) => {
      run += Number(m.net);
      return { id: m.id, date: m.date, label: label(m.type, m.number), dueDate: m.type === "invoice" ? m.due_date : null, amountCents: Number(m.net), balanceCents: run };
    });
  }
  const closing = kind === "open_item" ? rows.reduce((s, r) => s + r.amountCents, 0) : rows.length ? rows[rows.length - 1].balanceCents : opening;
  return {
    kind,
    from,
    to,
    company: { name: head.company_name, address: head.company_address ?? {}, email: head.company_email, phone: head.company_phone },
    customer: { id: customerId, name: head.name, address: head.address ?? {}, emails: head.emails ?? [] },
    openingCents: opening,
    rows,
    closingCents: closing,
    aging: bucket,
    brand: { accent: head.d?.accent ?? "#161a20", footer: head.d?.footer ?? null, logoAttachmentId: head.d?.logoAttachmentId ?? null },
  };
}
