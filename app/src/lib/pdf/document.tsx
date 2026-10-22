import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

// Our own invoice layout: plain, readable, prints well in black and white.

export interface PdfDoc {
  title: string; // "Invoice", "Sales receipt", ...
  number: string | null;
  date: string;
  dueDate: string | null;
  terms: string | null;
  company: { name: string; address: Record<string, string>; email: string | null; phone: string | null };
  customer: { name: string; address: Record<string, string> };
  lines: { name: string | null; description: string | null; qty: number | null; rateCents: number | null; amountCents: number }[];
  subtotalCents: number;
  discountCents: number;
  taxLabel: string | null;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  memo: string | null;
  voided: boolean;
  brand: { accent: string; logo: Buffer | null; footer: string | null; showQtyRate: boolean };
}

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#161a20" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  muted: { color: "#59626e" },
  bold: { fontFamily: "Helvetica-Bold" },
  label: { fontSize: 8, color: "#59626e", textTransform: "uppercase", marginBottom: 3, letterSpacing: 0.5 },
  th: { fontSize: 8, color: "#59626e", textTransform: "uppercase", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#e1e4e9" },
  td: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#eef0f3" },
  num: { textAlign: "right" },
  totals: { width: 220, marginLeft: "auto", marginTop: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  big: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  void: { position: "absolute", top: 300, left: 140, fontSize: 96, color: "#c22f2f", opacity: 0.15, transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold" },
});

function addressLines(a: Record<string, string>) {
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2, cityLine].filter(Boolean);
}

export function SalesPdf({ d }: { d: PdfDoc }) {
  const qtyCol = d.brand.showQtyRate && d.lines.some((l) => l.qty != null && l.qty !== 1);
  const accent = { color: d.brand.accent };
  return (
    <Document title={`${d.title} ${d.number ?? ""}`} author={d.company.name}>
      <Page size="LETTER" style={s.page}>
        {d.voided && <Text style={s.void}>VOID</Text>}
        <View style={s.between}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {d.brand.logo && <Image src={d.brand.logo} style={{ maxWidth: 140, maxHeight: 56, marginBottom: 8, objectFit: "contain" }} />}
            <Text style={[s.bold, { fontSize: 13 }]}>{d.company.name}</Text>
            {addressLines(d.company.address).map((l) => (
              <Text key={l} style={s.muted}>
                {l}
              </Text>
            ))}
            {d.company.email && <Text style={s.muted}>{d.company.email}</Text>}
            {d.company.phone && <Text style={s.muted}>{d.company.phone}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.h1, accent]}>{d.title}</Text>
            {d.number && <Text style={s.muted}>No. {d.number}</Text>}
          </View>
        </View>

        <View style={[s.row, { marginTop: 32, gap: 48 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.bold}>{d.customer.name}</Text>
            {addressLines(d.customer.address).map((l) => (
              <Text key={l}>{l}</Text>
            ))}
          </View>
          <View style={{ width: 200 }}>
            <View style={s.totalRow}>
              <Text style={s.muted}>Date</Text>
              <Text>{formatDate(d.date)}</Text>
            </View>
            {d.dueDate && (
              <View style={s.totalRow}>
                <Text style={s.muted}>{d.title === "Estimate" ? "Valid until" : "Due date"}</Text>
                <Text>{formatDate(d.dueDate)}</Text>
              </View>
            )}
            {d.terms && (
              <View style={s.totalRow}>
                <Text style={s.muted}>Terms</Text>
                <Text>{d.terms}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ marginTop: 28 }}>
          <View style={s.row}>
            <Text style={[s.th, { flex: 1 }]}>Description</Text>
            {qtyCol && <Text style={[s.th, s.num, { width: 50 }]}>Qty</Text>}
            {qtyCol && <Text style={[s.th, s.num, { width: 80 }]}>Rate</Text>}
            <Text style={[s.th, s.num, { width: 90 }]}>Amount</Text>
          </View>
          {d.lines.map((l, i) => (
            <View key={i} style={s.row} wrap={false}>
              <View style={[s.td, { flex: 1, paddingRight: 8 }]}>
                {l.name && <Text style={s.bold}>{l.name}</Text>}
                {l.description && <Text style={s.muted}>{l.description}</Text>}
              </View>
              {qtyCol && <Text style={[s.td, s.num, { width: 50 }]}>{l.qty ?? ""}</Text>}
              {qtyCol && <Text style={[s.td, s.num, { width: 80 }]}>{l.rateCents != null ? formatCents(Math.round(l.rateCents)) : ""}</Text>}
              <Text style={[s.td, s.num, { width: 90 }]}>{formatCents(l.amountCents)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{formatCents(d.subtotalCents)}</Text>
          </View>
          {d.discountCents > 0 && (
            <View style={s.totalRow}>
              <Text>Discount</Text>
              <Text>{formatCents(-d.discountCents)}</Text>
            </View>
          )}
          {d.taxLabel && (
            <View style={s.totalRow}>
              <Text>{d.taxLabel}</Text>
              <Text>{formatCents(d.taxCents)}</Text>
            </View>
          )}
          <View style={[s.totalRow, { borderTopWidth: 1, borderTopColor: d.brand.accent, marginTop: 4, paddingTop: 6 }]}>
            <Text style={s.bold}>Total</Text>
            <Text style={s.bold}>{formatCents(d.totalCents)}</Text>
          </View>
          {d.paidCents > 0 && (
            <View style={s.totalRow}>
              <Text>Payments received</Text>
              <Text>{formatCents(-d.paidCents)}</Text>
            </View>
          )}
          {d.title === "Invoice" && (
            <View style={[s.totalRow, { marginTop: 4 }]}>
              <Text style={[s.big, accent]}>Balance due</Text>
              <Text style={[s.big, accent]}>{formatCents(d.balanceCents)}</Text>
            </View>
          )}
        </View>

        {d.memo && (
          <View style={{ marginTop: 32 }}>
            <Text>{d.memo}</Text>
          </View>
        )}
        {d.brand.footer && (
          <Text style={{ position: "absolute", bottom: 32, left: 48, right: 48, textAlign: "center", fontSize: 8, color: "#59626e" }} fixed>
            {d.brand.footer}
          </Text>
        )}
      </Page>
    </Document>
  );
}

export interface StatementPdfDoc {
  title: string; // "Statement"
  kind: "balance_forward" | "open_item";
  from: string;
  to: string;
  company: PdfDoc["company"];
  customer: { name: string; address: Record<string, string> };
  openingCents: number;
  rows: { date: string; label: string; dueDate: string | null; amountCents: number; balanceCents: number }[];
  closingCents: number;
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d91: number };
  brand: { accent: string; logo: Buffer | null; footer: string | null };
}

export function StatementPdf({ d }: { d: StatementPdfDoc }) {
  const accent = { color: d.brand.accent };
  const fwd = d.kind === "balance_forward";
  const buckets: [string, number][] = [
    ["Current", d.aging.current],
    ["1-30 days", d.aging.d1_30],
    ["31-60 days", d.aging.d31_60],
    ["61-90 days", d.aging.d61_90],
    ["Over 90", d.aging.d91],
  ];
  return (
    <Document title={`Statement ${d.customer.name}`} author={d.company.name}>
      <Page size="LETTER" style={s.page}>
        <View style={s.between}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {d.brand.logo && <Image src={d.brand.logo} style={{ maxWidth: 140, maxHeight: 56, marginBottom: 8, objectFit: "contain" }} />}
            <Text style={[s.bold, { fontSize: 13 }]}>{d.company.name}</Text>
            {addressLines(d.company.address).map((l) => (
              <Text key={l} style={s.muted}>
                {l}
              </Text>
            ))}
            {d.company.email && <Text style={s.muted}>{d.company.email}</Text>}
            {d.company.phone && <Text style={s.muted}>{d.company.phone}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.h1, accent]}>Statement</Text>
            <Text style={s.muted}>{fwd ? `${formatDate(d.from)} to ${formatDate(d.to)}` : `As of ${formatDate(d.to)}`}</Text>
          </View>
        </View>

        <View style={[s.between, { marginTop: 32 }]}>
          <View>
            <Text style={s.label}>To</Text>
            <Text style={s.bold}>{d.customer.name}</Text>
            {addressLines(d.customer.address).map((l) => (
              <Text key={l}>{l}</Text>
            ))}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.label}>Amount due</Text>
            <Text style={[s.big, accent]}>{formatCents(d.closingCents)}</Text>
          </View>
        </View>

        <View style={{ marginTop: 28 }}>
          <View style={s.row}>
            <Text style={[s.th, { width: 70 }]}>Date</Text>
            <Text style={[s.th, { flex: 1 }]}>Activity</Text>
            <Text style={[s.th, { width: 70 }]}>Due</Text>
            <Text style={[s.th, s.num, { width: 85 }]}>{fwd ? "Amount" : "Open amount"}</Text>
            {fwd && <Text style={[s.th, s.num, { width: 85 }]}>Balance</Text>}
          </View>
          {fwd && (
            <View style={s.row}>
              <Text style={[s.td, { width: 70 }]}>{formatDate(d.from)}</Text>
              <Text style={[s.td, { flex: 1 }]}>Balance forward</Text>
              <Text style={[s.td, { width: 70 }]} />
              <Text style={[s.td, s.num, { width: 85 }]} />
              <Text style={[s.td, s.num, { width: 85 }]}>{formatCents(d.openingCents)}</Text>
            </View>
          )}
          {d.rows.map((r, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={[s.td, { width: 70 }]}>{formatDate(r.date)}</Text>
              <Text style={[s.td, { flex: 1 }]}>{r.label}</Text>
              <Text style={[s.td, { width: 70 }]}>{r.dueDate ? formatDate(r.dueDate) : ""}</Text>
              <Text style={[s.td, s.num, { width: 85 }]}>{formatCents(r.amountCents)}</Text>
              {fwd && <Text style={[s.td, s.num, { width: 85 }]}>{formatCents(r.balanceCents)}</Text>}
            </View>
          ))}
        </View>

        <View style={[s.row, { marginTop: 28, borderTopWidth: 1, borderTopColor: d.brand.accent }]} wrap={false}>
          {buckets.map(([k, v]) => (
            <View key={k} style={{ flex: 1, paddingTop: 6 }}>
              <Text style={s.label}>{k}</Text>
              <Text>{formatCents(v)}</Text>
            </View>
          ))}
          <View style={{ flex: 1, paddingTop: 6 }}>
            <Text style={s.label}>Amount due</Text>
            <Text style={s.bold}>{formatCents(d.closingCents)}</Text>
          </View>
        </View>

        {d.brand.footer && (
          <Text style={{ position: "absolute", bottom: 32, left: 48, right: 48, textAlign: "center", fontSize: 8, color: "#59626e" }} fixed>
            {d.brand.footer}
          </Text>
        )}
      </Page>
    </Document>
  );
}
