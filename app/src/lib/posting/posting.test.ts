import { describe, expect, it } from "vitest";
import { computeTotals, post, PostingError, type LedgerEntry, type PostingInput, type SystemAccounts, type TxnType } from ".";

const sys: SystemAccounts = {
  accountsReceivable: "AR",
  accountsPayable: "AP",
  undepositedFunds: "UF",
  salesTaxPayable: "TAX",
  discountsGiven: "DISC",
  openingBalanceEquity: "OBE",
};

/** account -> net debit (debits − credits) */
function net(entries: LedgerEntry[]) {
  const m: Record<string, number> = {};
  for (const e of entries) m[e.accountId] = (m[e.accountId] ?? 0) + e.debitCents - e.creditCents;
  return m;
}

const base = { date: "2026-10-01", contactId: "C1" };

describe("invoice", () => {
  it("debits A/R, credits income per line", () => {
    const { entries, totals } = post(
      { ...base, type: "invoice", lines: [{ accountId: "SALES", amountCents: 10000 }, { accountId: "SERVICES", amountCents: 5000 }] },
      sys,
    );
    expect(totals.totalCents).toBe(15000);
    expect(net(entries)).toEqual({ AR: 15000, SALES: -10000, SERVICES: -5000 });
    expect(entries.find((e) => e.accountId === "AR")?.contactId).toBe("C1");
  });

  it("handles discount before tax and tax on taxable lines only", () => {
    const input: PostingInput = {
      ...base,
      type: "invoice",
      discountCents: 1000,
      taxRateBp: 825,
      lines: [
        { accountId: "SALES", amountCents: 8000, taxable: true },
        { accountId: "SERVICES", amountCents: 2000, taxable: false },
      ],
    };
    const { entries, totals } = post(input, sys);
    // taxable share of the $10 discount = 10 × 80/100 = $8; taxable = 80 − 8 = $72; tax = 5.94
    expect(totals).toEqual({ subtotalCents: 10000, discountCents: 1000, taxableCents: 7200, taxCents: 594, totalCents: 9594 });
    expect(net(entries)).toEqual({ AR: 9594, SALES: -8000, SERVICES: -2000, DISC: 1000, TAX: -594 });
  });

  it("allows a negative line (a discount line) when the total stays positive", () => {
    const { entries } = post(
      { ...base, type: "invoice", lines: [{ accountId: "SALES", amountCents: 10000 }, { accountId: "PROMO", amountCents: -2500 }] },
      sys,
    );
    expect(net(entries)).toEqual({ AR: 7500, SALES: -10000, PROMO: 2500 });
  });

  it("rejects no customer, no lines, negative total, discount over subtotal", () => {
    expect(() => post({ ...base, contactId: null, type: "invoice", lines: [{ accountId: "S", amountCents: 1 }] }, sys)).toThrow(PostingError);
    expect(() => post({ ...base, type: "invoice", lines: [] }, sys)).toThrow("Add at least one line.");
    expect(() => post({ ...base, type: "invoice", lines: [{ accountId: "S", amountCents: -1 }] }, sys)).toThrow("negative");
    expect(() => post({ ...base, type: "invoice", discountCents: 200, lines: [{ accountId: "S", amountCents: 100 }] }, sys)).toThrow("Discount");
  });

  it("voided posts nothing", () => {
    const { entries, totals } = post({ ...base, type: "invoice", status: "voided", lines: [{ accountId: "S", amountCents: 100 }] }, sys);
    expect(entries).toEqual([]);
    expect(totals.totalCents).toBe(100);
  });
});

describe("customer side", () => {
  it("payment defaults to Undeposited Funds", () => {
    const { entries } = post({ ...base, type: "payment", amountCents: 5000, lines: [] }, sys);
    expect(net(entries)).toEqual({ UF: 5000, AR: -5000 });
  });
  it("payment straight to the bank", () => {
    expect(net(post({ ...base, type: "payment", accountId: "BANK", amountCents: 5000, lines: [] }, sys).entries)).toEqual({ BANK: 5000, AR: -5000 });
  });
  it("sales receipt debits the deposit account", () => {
    const { entries } = post({ ...base, type: "sales_receipt", accountId: "UF", taxRateBp: 1000, lines: [{ accountId: "SALES", amountCents: 1000, taxable: true }] }, sys);
    expect(net(entries)).toEqual({ UF: 1100, SALES: -1000, TAX: -100 });
  });
  it("credit memo reverses an invoice", () => {
    const { entries } = post({ ...base, type: "credit_memo", taxRateBp: 1000, lines: [{ accountId: "SALES", amountCents: 1000, taxable: true }] }, sys);
    expect(net(entries)).toEqual({ AR: -1100, SALES: 1000, TAX: 100 });
  });
  it("refund receipt pays out of the bank", () => {
    const { entries } = post({ ...base, type: "refund_receipt", accountId: "BANK", lines: [{ accountId: "SALES", amountCents: 1000 }] }, sys);
    expect(net(entries)).toEqual({ BANK: -1000, SALES: 1000 });
  });
});

describe("vendor side", () => {
  it("expense with a split, paid by card", () => {
    const { entries } = post(
      { ...base, contactId: "V1", type: "expense", accountId: "CARD", lines: [{ accountId: "MEALS", amountCents: 3000 }, { accountId: "TRAVEL", amountCents: 7000 }] },
      sys,
    );
    expect(net(entries)).toEqual({ CARD: -10000, MEALS: 3000, TRAVEL: 7000 });
  });
  it("bill credits A/P with the vendor, bill payment clears it", () => {
    const bill = post({ ...base, contactId: "V1", type: "bill", lines: [{ accountId: "RENT", amountCents: 200000 }] }, sys);
    expect(net(bill.entries)).toEqual({ RENT: 200000, AP: -200000 });
    expect(bill.entries.find((e) => e.accountId === "AP")?.contactId).toBe("V1");
    const pay = post({ ...base, contactId: "V1", type: "bill_payment", accountId: "BANK", amountCents: 200000, lines: [] }, sys);
    expect(net(pay.entries)).toEqual({ AP: 200000, BANK: -200000 });
  });
  it("vendor credit and credit card credit", () => {
    expect(net(post({ ...base, contactId: "V1", type: "vendor_credit", lines: [{ accountId: "SUP", amountCents: 500 }] }, sys).entries)).toEqual({ AP: 500, SUP: -500 });
    expect(net(post({ ...base, type: "credit_card_credit", accountId: "CARD", lines: [{ accountId: "SUP", amountCents: 500 }] }, sys).entries)).toEqual({ CARD: 500, SUP: -500 });
  });
});

describe("money movement", () => {
  it("deposit groups undeposited payments, with a fee line", () => {
    const { entries } = post(
      { ...base, type: "deposit", accountId: "BANK", lines: [{ accountId: "UF", amountCents: 5000 }, { accountId: "UF", amountCents: 2500 }, { accountId: "FEES", amountCents: -300 }] },
      sys,
    );
    expect(net(entries)).toEqual({ BANK: 7200, UF: -7500, FEES: 300 });
  });
  it("transfer", () => {
    expect(net(post({ ...base, type: "transfer", accountId: "SAVINGS", fromAccountId: "BANK", amountCents: 100, lines: [] }, sys).entries)).toEqual({ SAVINGS: 100, BANK: -100 });
    expect(() => post({ ...base, type: "transfer", accountId: "BANK", fromAccountId: "BANK", amountCents: 100, lines: [] }, sys)).toThrow();
  });
  it("journal entry must balance", () => {
    const ok = post(
      { ...base, type: "journal_entry", lines: [{ accountId: "DEPR", amountCents: 1000, side: "debit" }, { accountId: "ACCUM", amountCents: 1000, side: "credit" }] },
      sys,
    );
    expect(net(ok.entries)).toEqual({ DEPR: 1000, ACCUM: -1000 });
    expect(() =>
      post({ ...base, type: "journal_entry", lines: [{ accountId: "A", amountCents: 1000, side: "debit" }, { accountId: "B", amountCents: 999, side: "credit" }] }, sys),
    ).toThrow("off by 0.01");
  });
  it("opening balance for an asset and for a credit card", () => {
    expect(net(post({ ...base, type: "opening_balance", accountId: "BANK", amountCents: 50000, lines: [] }, sys).entries)).toEqual({ BANK: 50000, OBE: -50000 });
    expect(net(post({ ...base, type: "opening_balance", accountId: "CARD", amountCents: -12000, lines: [] }, sys).entries)).toEqual({ CARD: -12000, OBE: 12000 });
  });
});

describe("property: every posting balances", () => {
  // Deterministic pseudo-random inputs (no extra dependency).
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const types: TxnType[] = ["invoice", "sales_receipt", "credit_memo", "refund_receipt", "expense", "check", "bill", "vendor_credit", "credit_card_credit", "deposit"];

  it("holds for 2,000 random transactions", () => {
    let posted = 0;
    for (let n = 0; n < 2000; n++) {
      const type = types[int(0, types.length - 1)];
      const lines = Array.from({ length: int(1, 6) }, (_, i) => ({ accountId: `L${i}`, amountCents: int(1, 500000), taxable: rnd() < 0.5 }));
      const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
      const input: PostingInput = {
        ...base,
        type,
        accountId: "BANK",
        lines,
        discountCents: rnd() < 0.3 ? int(0, subtotal) : 0,
        taxRateBp: rnd() < 0.5 ? int(0, 1500) : null,
      };
      const { entries, totals } = post(input, sys);
      const d = entries.reduce((s, e) => s + e.debitCents, 0);
      const c = entries.reduce((s, e) => s + e.creditCents, 0);
      expect(d).toBe(c);
      expect(totals.totalCents).toBeGreaterThanOrEqual(0);
      posted++;
    }
    expect(posted).toBe(2000);
  });
});

describe("computeTotals", () => {
  it("no tax rate means no tax", () => {
    expect(computeTotals([{ accountId: "S", amountCents: 1000, taxable: true }]).taxCents).toBe(0);
  });
});

describe("phase 2 types", () => {
  it("sales tax payment clears the liability", () => {
    expect(net(post({ ...base, contactId: null, type: "sales_tax_payment", accountId: "BANK", amountCents: 825, lines: [] }, sys).entries)).toEqual({ TAX: 825, BANK: -825 });
  });
  it("estimates and purchase orders never post", () => {
    const e = post({ ...base, type: "estimate", taxRateBp: 1000, lines: [{ accountId: "S", amountCents: 1000, taxable: true }] }, sys);
    expect(e.entries).toEqual([]);
    expect(e.totals.totalCents).toBe(1100);
    const po = post({ ...base, type: "purchase_order", lines: [{ accountId: "SUP", amountCents: 500 }] }, sys);
    expect(po.entries).toEqual([]);
    expect(po.totals.totalCents).toBe(500);
  });
  it("carries the class onto ledger entries", () => {
    const { entries } = post({ ...base, type: "invoice", lines: [{ accountId: "S", amountCents: 1000, classId: "CL1" }] }, sys);
    expect(entries.find((e) => e.accountId === "S")?.classId).toBe("CL1");
    expect(entries.find((e) => e.accountId === "AR")?.classId).toBeNull();
  });
});
