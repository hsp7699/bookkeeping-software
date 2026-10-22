import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { one } from "@/db";
import { getFile } from "@/lib/storage";
import { SalesPdf, StatementPdf, type PdfDoc } from "./document";
import type { Statement } from "@/lib/statements";

const TITLE: Record<string, string> = { invoice: "Invoice", sales_receipt: "Sales receipt", credit_memo: "Credit memo", refund_receipt: "Refund receipt", estimate: "Estimate" };

export async function loadPdfDoc(companyId: string, id: string, type: string): Promise<PdfDoc | null> {
  const r = await one<{
    number: string | null;
    txn_date: string;
    due_date: string | null;
    terms: string | null;
    company_name: string;
    company_address: Record<string, string>;
    company_email: string | null;
    company_phone: string | null;
    customer_name: string;
    customer_address: Record<string, string>;
    lines: PdfDoc["lines"];
    subtotal_cents: number;
    discount_cents: number;
    tax_name: string | null;
    tax_rate_bp: number | null;
    tax_cents: number;
    total_cents: number;
    balance_cents: number;
    memo: string | null;
    status: string;
    expires_on: string | null;
    invoice_defaults: { accent?: string; logoAttachmentId?: string; footer?: string; showQtyRate?: boolean } | null;
  }>(
    `select t.number, t.txn_date, t.due_date, tm.name as terms, co.name as company_name, co.address as company_address,
            co.email as company_email, co.phone as company_phone, c.display_name as customer_name,
            coalesce(t.billing_address, c.billing_address) as customer_address,
            coalesce((select json_agg(json_build_object('name', i.name, 'description', l.description, 'qty', l.qty,
               'rateCents', l.rate_cents, 'amountCents', l.amount_cents) order by l.position)
              from transaction_lines l left join items i on i.id = l.item_id where l.transaction_id = t.id), '[]') as lines,
            t.expires_on, co.invoice_defaults, t.subtotal_cents, t.discount_cents, tr.name as tax_name, tr.rate_bp as tax_rate_bp, t.tax_cents, t.total_cents, t.balance_cents, t.memo, t.status
     from transactions t
     join companies co on co.id = t.company_id
     join contacts c on c.id = t.contact_id
     left join terms tm on tm.id = t.terms_id
     left join tax_rates tr on tr.id = t.tax_rate_id
     where t.company_id = $1 and t.id = $2 and t.type = $3`,
    [companyId, id, type],
  );
  if (!r) return null;
  const isInvoice = type === "invoice";
  const brand = r.invoice_defaults ?? {};
  const logo = await loadLogo(companyId, brand.logoAttachmentId);
  return {
    title: TITLE[type],
    number: r.number,
    date: r.txn_date,
    dueDate: isInvoice ? r.due_date : type === "estimate" ? r.expires_on : null,
    terms: isInvoice ? r.terms : null,
    company: { name: r.company_name, address: r.company_address ?? {}, email: r.company_email, phone: r.company_phone },
    customer: { name: r.customer_name, address: r.customer_address ?? {} },
    lines: r.lines.map((l) => ({ ...l, qty: l.qty == null ? null : Number(l.qty), rateCents: l.rateCents == null ? null : Number(l.rateCents) })),
    subtotalCents: r.subtotal_cents,
    discountCents: r.discount_cents,
    taxLabel: r.tax_name ? `${r.tax_name} (${((r.tax_rate_bp ?? 0) / 100).toFixed(2)}%)` : null,
    taxCents: r.tax_cents,
    totalCents: r.total_cents,
    paidCents: isInvoice ? r.total_cents - r.balance_cents : 0,
    balanceCents: isInvoice ? r.balance_cents : 0,
    memo: r.memo,
    voided: r.status === "voided",
    brand: { accent: brand.accent ?? "#161a20", logo, footer: brand.footer ?? null, showQtyRate: brand.showQtyRate ?? true },
  };
}

export async function renderSalesPdf(doc: PdfDoc): Promise<Buffer> {
  return renderToBuffer(<SalesPdf d={doc} />);
}

async function loadLogo(companyId: string, attachmentId: string | null | undefined) {
  if (!attachmentId) return null;
  const a = await one<{ storage_key: string }>("select storage_key from attachments where company_id = $1 and id = $2", [companyId, attachmentId]);
  return a ? getFile(a.storage_key).catch(() => null) : null;
}

export async function renderStatementPdf(companyId: string, st: Statement): Promise<Buffer> {
  const logo = await loadLogo(companyId, st.brand.logoAttachmentId);
  return renderToBuffer(<StatementPdf d={{ ...st, title: "Statement", brand: { ...st.brand, logo } }} />);
}
