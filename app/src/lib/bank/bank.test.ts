import { describe, expect, it } from "vitest";
import { guessColumns, parseCsv, parseOfx, rowsFromCsv, toIsoDate } from "./parse";
import { firstMatchingRule, splitAmounts, type Rule } from "./rules";

describe("parseCsv", () => {
  it("handles quotes, commas and newlines in fields, BOM and CRLF", () => {
    const t = parseCsv('﻿Date,Description,Amount\r\n10/01/2026,"ACME, INC ""HQ""",-12.50\r\n10/02/2026,"multi\nline",5\r\n\r\n');
    expect(t).toEqual([
      ["Date", "Description", "Amount"],
      ["10/01/2026", 'ACME, INC "HQ"', "-12.50"],
      ["10/02/2026", "multi\nline", "5"],
    ]);
  });
});

describe("toIsoDate", () => {
  it.each([
    ["10/05/2026", "MDY", "2026-10-05"],
    ["5/10/26", "DMY", "2026-10-05"],
    ["2026-10-05", "MDY", "2026-10-05"],
    ["20261005120000[-5:EST]", "YMD", "2026-10-05"],
    ["02/30/2026", "MDY", null],
    ["hello", "MDY", null],
  ] as const)("%s (%s) -> %s", (raw, fmt, iso) => expect(toIsoDate(raw, fmt)).toBe(iso));
});

describe("CSV import", () => {
  it("guesses a signed amount column", () => {
    const t = parseCsv("Posted Date,Payee,Amount\n10/01/2026,STARBUCKS #123,-5.75\n10/01/2026,STARBUCKS #123,-5.75\n10/02/2026,Client deposit,1200.00\n");
    const map = guessColumns(t);
    expect(map).toMatchObject({ hasHeader: true, date: 0, description: 1, amount: 2, dateFormat: "MDY" });
    const r = rowsFromCsv(t, map);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.amountCents)).toEqual([-575, -575, 120000]);
    // identical rows get distinct ids; re-parsing gives the same ids
    expect(new Set(r.rows.map((x) => x.externalId)).size).toBe(3);
    expect(rowsFromCsv(t, map).rows.map((x) => x.externalId)).toEqual(r.rows.map((x) => x.externalId));
  });

  it("guesses debit and credit columns", () => {
    const t = parseCsv("Date,Description,Debit,Credit\n2026-10-01,Rent,2000.00,\n2026-10-03,Refund,,15.00\n");
    const map = guessColumns(t);
    expect(map).toMatchObject({ debit: 2, credit: 3, amount: null, dateFormat: "YMD" });
    expect(rowsFromCsv(t, map).rows.map((x) => x.amountCents)).toEqual([-200000, 1500]);
  });

  it("reports unreadable rows with line numbers", () => {
    const t = parseCsv("Date,Description,Amount\nnot a date,x,1\n10/01/2026,y,abc\n");
    const r = rowsFromCsv(t, guessColumns(t));
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it("can invert signs for card exports", () => {
    const t = parseCsv("Date,Description,Amount\n10/01/2026,Hotel,250.00\n");
    expect(rowsFromCsv(t, { ...guessColumns(t), invert: true }).rows[0].amountCents).toBe(-25000);
  });
});

describe("OFX", () => {
  const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001120000[-5:EST]<TRNAMT>-42.10<FITID>A1<NAME>SHELL OIL 123<MEMO>FUEL
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>1500.00<FITID>A2<NAME>NORTHSIDE DENTAL &amp; CO
</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>8123.45<DTASOF>20261002</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  it("parses SGML OFX with FITIDs and the ledger balance", () => {
    const r = parseOfx(ofx);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: "2026-10-01", description: "SHELL OIL 123", bankText: "SHELL OIL 123 FUEL", amountCents: -4210, externalId: "ofx:A1" },
      { date: "2026-10-02", description: "NORTHSIDE DENTAL & CO", bankText: "NORTHSIDE DENTAL & CO", amountCents: 150000, externalId: "ofx:A2" },
    ]);
    expect(r.ledgerBalanceCents).toBe(812345);
  });
});

describe("rules", () => {
  const base = { priority: 1, direction: "both" as const, feedAccountIds: null, matchMode: "all" as const, autoConfirm: false, actions: { txnType: "expense" as const, splits: [] } };
  const rules: Rule[] = [
    { ...base, id: "fuel", name: "Fuel", priority: 2, conditions: [{ field: "description", op: "contains", value: "shell" }] },
    { ...base, id: "big", name: "Big shell", priority: 1, conditions: [{ field: "description", op: "contains", value: "shell" }, { field: "amount", op: "gt", value: "100" }] },
    { ...base, id: "in", name: "Deposits", priority: 3, direction: "in", conditions: [{ field: "bank_text", op: "contains", value: "dental" }] },
  ];
  const row = (description: string, amountCents: number) => ({ feedAccountId: "F", description, bankText: description, amountCents });
  it("picks the first match by priority", () => {
    expect(firstMatchingRule(rules, row("SHELL OIL", -4210))?.id).toBe("fuel");
    expect(firstMatchingRule(rules, row("SHELL OIL", -15000))?.id).toBe("big");
    expect(firstMatchingRule(rules, row("NORTHSIDE DENTAL", 150000))?.id).toBe("in");
    expect(firstMatchingRule(rules, row("NORTHSIDE DENTAL", -150000))).toBeNull();
  });
  it("splits always sum to the row amount", () => {
    expect(splitAmounts([{ accountId: "A", percentBp: 3333 }, { accountId: "B", percentBp: 6667 }], -1000)).toEqual([
      { accountId: "A", amountCents: 333 },
      { accountId: "B", amountCents: 667 },
    ]);
    const s = splitAmounts([{ accountId: "A", amountCents: 500 }, { accountId: "B" }], 1999);
    expect(s).toEqual([{ accountId: "A", amountCents: 500 }, { accountId: "B", amountCents: 1499 }]);
  });
});
