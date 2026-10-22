// Bank file parsing: CSV (with a column map) and OFX/QFX/QBO (FITID-keyed).
// Pure functions; amounts come out as integer cents, + money in / − money out.

import { parseMoney } from "@/lib/money";

export interface BankRow {
  date: string; // YYYY-MM-DD
  description: string;
  bankText: string | null;
  amountCents: number;
  /** stable id: FITID for OFX, or a content hash with an occurrence counter for CSV */
  externalId: string;
}

export interface ParseResult {
  rows: BankRow[];
  errors: { line: number; message: string }[];
  /** ending balance reported by the bank (OFX LEDGERBAL), if any */
  ledgerBalanceCents: number | null;
}

// ------------------------------------------------------------------ CSV

/** RFC 4180-ish: quoted fields, doubled quotes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface ColumnMap {
  hasHeader: boolean;
  date: number;
  description: number;
  /** either one signed amount column... */
  amount?: number | null;
  /** ...or separate columns for money out and money in */
  debit?: number | null;
  credit?: number | null;
  /** flip signs (some card exports show charges as positive) */
  invert?: boolean;
  dateFormat: "MDY" | "DMY" | "YMD";
}

const DATE_HINT = /date|posted/i;
const DESC_HINT = /desc|payee|name|memo|detail|narrative/i;
const AMOUNT_HINT = /^amount$|amount|amt/i;
const DEBIT_HINT = /debit|withdraw|money out|paid out|spent/i;
const CREDIT_HINT = /credit|deposit|money in|paid in|received/i;

/** Guess a column map from the header row and the first data rows. */
export function guessColumns(table: string[][]): ColumnMap {
  const head = table[0] ?? [];
  const hasHeader = head.some((h) => /[a-z]/i.test(h)) && !head.some((h) => toIsoDate(h, "MDY") || toIsoDate(h, "YMD"));
  const find = (re: RegExp, skip: number[] = []) => {
    const i = head.findIndex((h, idx) => !skip.includes(idx) && re.test(h.trim()));
    return i >= 0 ? i : null;
  };
  const sample = table.slice(hasHeader ? 1 : 0, 30);
  let date = hasHeader ? find(DATE_HINT) : null;
  if (date == null) date = head.findIndex((_, i) => sample.every((r) => !r[i] || toIsoDate(r[i], "MDY") || toIsoDate(r[i], "YMD")));
  const description = (hasHeader ? find(DESC_HINT) : null) ?? head.findIndex((_, i) => i !== date && sample.some((r) => /[a-z]{3}/i.test(r[i] ?? "")));
  const debit = hasHeader ? find(DEBIT_HINT, [date, description]) : null;
  const credit = hasHeader ? find(CREDIT_HINT, [date, description, debit ?? -1]) : null;
  const amount = debit != null && credit != null ? null : ((hasHeader ? find(AMOUNT_HINT, [date, description]) : null) ?? head.findIndex((_, i) => i !== date && i !== description && sample.every((r) => !r[i] || parseMoney(r[i]) != null)));
  return {
    hasHeader,
    date: Math.max(date, 0),
    description: Math.max(description, 0),
    amount: amount != null && amount >= 0 ? amount : null,
    debit: amount == null ? debit : null,
    credit: amount == null ? credit : null,
    invert: false,
    dateFormat: guessDateFormat(sample.map((r) => r[Math.max(date, 0)] ?? "")),
  };
}

function guessDateFormat(values: string[]): ColumnMap["dateFormat"] {
  if (values.some((v) => /^\d{4}[-/]/.test(v.trim()))) return "YMD";
  // a first part over 12 means day-first
  if (values.some((v) => Number(v.trim().split(/[/.-]/)[0]) > 12)) return "DMY";
  return "MDY";
}

/** Normalise a bank date to YYYY-MM-DD, or null. Two-digit years are 20xx. */
export function toIsoDate(raw: string, fmt: ColumnMap["dateFormat"]): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const parts = s.split(/[/.-]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    // OFX style 20261005 or 20261005120000[-5:EST]
    const m8 = /^(\d{4})(\d{2})(\d{2})/.exec(s);
    if (!m8) return null;
    [y, m, d] = [Number(m8[1]), Number(m8[2]), Number(m8[3])];
  } else if (fmt === "YMD" || parts[0].length === 4) [y, m, d] = parts.map(Number);
  else if (fmt === "DMY") [d, m, y] = parts.map(Number);
  else [m, d, y] = parts.map(Number);
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function fingerprint(s: string): string {
  // FNV-1a 32-bit, hex. Stable across runs; collisions are handled by the occurrence counter.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Give identical rows distinct ids by counting occurrences, so two $5 coffees on one day both import. */
function withOccurrenceIds(rows: Omit<BankRow, "externalId">[]): BankRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `${r.date}|${r.amountCents}|${r.description.trim().toLowerCase()}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { ...r, externalId: `csv:${fingerprint(key)}:${n}` };
  });
}

export function rowsFromCsv(table: string[][], map: ColumnMap): ParseResult {
  const errors: ParseResult["errors"] = [];
  const out: Omit<BankRow, "externalId">[] = [];
  table.slice(map.hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (map.hasHeader ? 2 : 1);
    const date = toIsoDate(r[map.date] ?? "", map.dateFormat);
    if (!date) return errors.push({ line, message: `Couldn't read the date "${r[map.date] ?? ""}".` });
    let amount: number | null;
    if (map.amount != null) amount = parseMoney(r[map.amount] ?? "");
    else {
      const out_ = parseMoney(r[map.debit ?? -1] ?? "") ?? 0;
      const in_ = parseMoney(r[map.credit ?? -1] ?? "") ?? 0;
      amount = (r[map.debit ?? -1] ?? "").trim() || (r[map.credit ?? -1] ?? "").trim() ? in_ - Math.abs(out_) : null;
    }
    if (amount == null) return errors.push({ line, message: `Couldn't read the amount.` });
    if (map.invert) amount = -amount;
    if (amount === 0) return;
    const description = (r[map.description] ?? "").replace(/\s+/g, " ").trim() || "(no description)";
    out.push({ date, description, bankText: description, amountCents: amount });
  });
  return { rows: withOccurrenceIds(out), errors, ledgerBalanceCents: null };
}

// ------------------------------------------------------------------ OFX / QFX / QBO

function tag(block: string, name: string): string | null {
  // SGML OFX may omit closing tags: the value runs to the next "<" or line end
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  return m ? m[1].trim() : null;
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}

export function parseOfx(text: string): ParseResult {
  const errors: ParseResult["errors"] = [];
  const rows: BankRow[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  if (blocks.length === 0 && !/<OFX>/i.test(text)) {
    return { rows, errors: [{ line: 1, message: "This doesn't look like an OFX, QFX or QBO file." }], ledgerBalanceCents: null };
  }
  blocks.forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = toIsoDate(tag(block, "DTPOSTED") ?? "", "YMD");
    const amount = parseMoney(tag(block, "TRNAMT") ?? "");
    const fitid = tag(block, "FITID");
    const name = decodeEntities(tag(block, "NAME") ?? tag(block, "PAYEE") ?? "");
    const memo = decodeEntities(tag(block, "MEMO") ?? "");
    if (!date || amount == null) return errors.push({ line: i + 1, message: "A transaction is missing its date or amount." });
    if (amount === 0) return;
    const description = (name || memo || "(no description)").replace(/\s+/g, " ").trim();
    rows.push({
      date,
      description,
      bankText: [name, memo].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || null,
      amountCents: amount,
      externalId: fitid ? `ofx:${fitid}` : `ofx:${fingerprint(`${date}|${amount}|${description}`)}:${i}`,
    });
  });
  const ledger = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i.exec(text);
  return { rows, errors, ledgerBalanceCents: ledger ? parseMoney(ledger[1]) : null };
}

export function detectFormat(fileName: string, text: string): "csv" | "ofx" | "qfx" | "qbo" {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "qfx" || ext === "qbo" || ext === "ofx") return ext;
  if (/<OFX>|OFXHEADER/i.test(text.slice(0, 2000))) return "ofx";
  return "csv";
}
