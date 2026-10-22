// The posting engine: turns a transaction into balanced double-entry ledger
// entries. Pure functions, no database. Every report reads what this writes,
// so every rule here is covered by posting.test.ts.

import { applyRate, roundCents, type Cents } from "@/lib/money";

export type TxnType =
  | "invoice"
  | "sales_receipt"
  | "payment"
  | "credit_memo"
  | "refund_receipt"
  | "expense"
  | "check"
  | "bill"
  | "bill_payment"
  | "vendor_credit"
  | "credit_card_credit"
  | "deposit"
  | "transfer"
  | "journal_entry"
  | "opening_balance";

export interface SystemAccounts {
  accountsReceivable: string;
  accountsPayable: string;
  undepositedFunds: string;
  salesTaxPayable: string;
  discountsGiven: string;
  openingBalanceEquity: string;
}

export interface PostingLine {
  /** resolved ledger account: the item's income/expense account, or the category */
  accountId: string;
  amountCents: Cents;
  taxable?: boolean;
  /** journal entries only */
  side?: "debit" | "credit";
  contactId?: string | null;
  lineId?: string;
  description?: string | null;
}

export interface PostingInput {
  type: TxnType;
  date: string; // YYYY-MM-DD
  status?: "posted" | "voided";
  contactId?: string | null;
  /**
   * The money side of the form: deposit-to (sales receipt, payment, deposit),
   * paid-from (expense, check, refund, bill payment), the credit card
   * (credit_card_credit), to-account (transfer), the account (opening_balance).
   */
  accountId?: string | null;
  /** transfer only: the from-account */
  fromAccountId?: string | null;
  /** payment / bill payment / transfer / opening balance amount */
  amountCents?: Cents;
  lines: PostingLine[];
  discountCents?: Cents;
  taxRateBp?: number | null;
}

export interface LedgerEntry {
  accountId: string;
  debitCents: Cents;
  creditCents: Cents;
  contactId: string | null;
  lineId: string | null;
  memo: string | null;
}

export interface Totals {
  subtotalCents: Cents;
  discountCents: Cents;
  taxableCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export class PostingError extends Error {}

/**
 * Subtotal, discount, tax and total for a sales form. The discount is taken
 * before tax and spread over taxable and non-taxable lines in proportion.
 * Tax is computed once on the taxable amount, not per line.
 */
export function computeTotals(lines: PostingLine[], discountCents = 0, taxRateBp: number | null = null): Totals {
  const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxableGross = lines.filter((l) => l.taxable).reduce((s, l) => s + l.amountCents, 0);
  if (discountCents < 0) throw new PostingError("Discount can't be negative.");
  if (discountCents > Math.max(subtotal, 0)) throw new PostingError("Discount can't be more than the subtotal.");
  const taxableDiscount =
    discountCents > 0 && subtotal > 0 ? roundCents((discountCents * taxableGross) / subtotal) : 0;
  const taxable = taxableGross - taxableDiscount;
  const tax = taxRateBp ? applyRate(taxable, taxRateBp) : 0;
  return {
    subtotalCents: subtotal,
    discountCents,
    taxableCents: taxable,
    taxCents: tax,
    totalCents: subtotal - discountCents + tax,
  };
}

class Builder {
  entries: LedgerEntry[] = [];
  /** Post `amount` on `side`; a negative amount posts to the other side. Zero posts nothing. */
  post(side: "debit" | "credit", accountId: string, amount: Cents, opts: Partial<LedgerEntry> = {}) {
    if (amount === 0) return;
    const flip = amount < 0;
    const s = flip ? (side === "debit" ? "credit" : "debit") : side;
    const abs = Math.abs(amount);
    this.entries.push({
      accountId,
      debitCents: s === "debit" ? abs : 0,
      creditCents: s === "credit" ? abs : 0,
      contactId: opts.contactId ?? null,
      lineId: opts.lineId ?? null,
      memo: opts.memo ?? null,
    });
  }
  lines(side: "debit" | "credit", lines: PostingLine[], contactId: string | null = null) {
    for (const l of lines) {
      this.post(side, l.accountId, l.amountCents, {
        lineId: l.lineId ?? null,
        memo: l.description ?? null,
        contactId: l.contactId ?? contactId,
      });
    }
  }
}

function need<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined || value === "") throw new PostingError(message);
  return value;
}

function sum(lines: PostingLine[]): Cents {
  return lines.reduce((s, l) => s + l.amountCents, 0);
}

/** Ledger entries for a transaction. Throws PostingError on invalid input. */
export function post(input: PostingInput, sys: SystemAccounts): { entries: LedgerEntry[]; totals: Totals } {
  const b = new Builder();
  const contact = input.contactId ?? null;
  const salesTotals = () => computeTotals(input.lines, input.discountCents ?? 0, input.taxRateBp ?? null);
  const plainTotals = (total: Cents): Totals => ({
    subtotalCents: total,
    discountCents: 0,
    taxableCents: 0,
    taxCents: 0,
    totalCents: total,
  });
  let totals: Totals;

  switch (input.type) {
    case "invoice":
    case "sales_receipt":
    case "credit_memo":
    case "refund_receipt": {
      need(contact, "Choose a customer.");
      if (input.lines.length === 0) throw new PostingError("Add at least one line.");
      totals = salesTotals();
      if (totals.totalCents < 0) throw new PostingError("The total can't be negative.");
      // "money side" debit for sales, credit for the reversing forms
      const forward = input.type === "invoice" || input.type === "sales_receipt";
      const moneyAccount =
        input.type === "invoice" || input.type === "credit_memo"
          ? sys.accountsReceivable
          : need(input.accountId, input.type === "sales_receipt" ? "Choose a deposit-to account." : "Choose the account the refund is paid from.");
      const moneyContact = moneyAccount === sys.accountsReceivable ? contact : null;
      b.post(forward ? "debit" : "credit", moneyAccount, totals.totalCents, { contactId: moneyContact });
      b.lines(forward ? "credit" : "debit", input.lines);
      b.post(forward ? "debit" : "credit", sys.discountsGiven, totals.discountCents);
      b.post(forward ? "credit" : "debit", sys.salesTaxPayable, totals.taxCents);
      break;
    }

    case "payment": {
      need(contact, "Choose a customer.");
      const amount = need(input.amountCents, "Enter the amount received.");
      if (amount <= 0) throw new PostingError("The amount received must be more than zero.");
      const to = input.accountId || sys.undepositedFunds;
      b.post("debit", to, amount);
      b.post("credit", sys.accountsReceivable, amount, { contactId: contact });
      totals = plainTotals(amount);
      break;
    }

    case "expense":
    case "check": {
      const from = need(input.accountId, "Choose the account it was paid from.");
      if (input.lines.length === 0) throw new PostingError("Add at least one line.");
      const total = sum(input.lines);
      if (total < 0) throw new PostingError("The total can't be negative.");
      b.lines("debit", input.lines);
      b.post("credit", from, total);
      totals = plainTotals(total);
      break;
    }

    case "credit_card_credit": {
      const card = need(input.accountId, "Choose the credit card.");
      if (input.lines.length === 0) throw new PostingError("Add at least one line.");
      const total = sum(input.lines);
      if (total < 0) throw new PostingError("The total can't be negative.");
      b.post("debit", card, total);
      b.lines("credit", input.lines);
      totals = plainTotals(total);
      break;
    }

    case "bill":
    case "vendor_credit": {
      need(contact, "Choose a vendor.");
      if (input.lines.length === 0) throw new PostingError("Add at least one line.");
      const total = sum(input.lines);
      if (total < 0) throw new PostingError("The total can't be negative.");
      const isBill = input.type === "bill";
      b.lines(isBill ? "debit" : "credit", input.lines);
      b.post(isBill ? "credit" : "debit", sys.accountsPayable, total, { contactId: contact });
      totals = plainTotals(total);
      break;
    }

    case "bill_payment": {
      need(contact, "Choose a vendor.");
      const from = need(input.accountId, "Choose the account it was paid from.");
      const amount = need(input.amountCents, "Enter the payment amount.");
      if (amount <= 0) throw new PostingError("The payment must be more than zero.");
      b.post("debit", sys.accountsPayable, amount, { contactId: contact });
      b.post("credit", from, amount);
      totals = plainTotals(amount);
      break;
    }

    case "deposit": {
      // Lines are what was deposited: grouped payments (account = Undeposited
      // Funds) and other income lines. A negative line is cash back or a fee.
      const to = need(input.accountId, "Choose the account to deposit to.");
      if (input.lines.length === 0) throw new PostingError("Add at least one payment or line.");
      const total = sum(input.lines);
      if (total <= 0) throw new PostingError("The deposit total must be more than zero.");
      b.post("debit", to, total);
      b.lines("credit", input.lines);
      totals = plainTotals(total);
      break;
    }

    case "transfer": {
      const to = need(input.accountId, "Choose the account to transfer to.");
      const from = need(input.fromAccountId, "Choose the account to transfer from.");
      if (to === from) throw new PostingError("Transfer between two different accounts.");
      const amount = need(input.amountCents, "Enter the transfer amount.");
      if (amount <= 0) throw new PostingError("The transfer amount must be more than zero.");
      b.post("debit", to, amount);
      b.post("credit", from, amount);
      totals = plainTotals(amount);
      break;
    }

    case "journal_entry": {
      const lines = input.lines.filter((l) => l.amountCents !== 0);
      if (lines.length < 2) throw new PostingError("A journal entry needs at least two lines.");
      let debits = 0;
      let credits = 0;
      for (const l of lines) {
        const side = need(l.side, "Each journal entry line needs a debit or a credit.");
        if (l.amountCents < 0) throw new PostingError("Enter journal entry amounts as positive numbers.");
        if (side === "debit") debits += l.amountCents;
        else credits += l.amountCents;
        b.post(side, l.accountId, l.amountCents, { lineId: l.lineId ?? null, memo: l.description ?? null, contactId: l.contactId ?? null });
      }
      if (debits !== credits) {
        throw new PostingError(`Debits and credits must be equal. They're off by ${Math.abs(debits - credits) / 100}.`);
      }
      totals = plainTotals(debits);
      break;
    }

    case "opening_balance": {
      // amount is the balance in the account's natural sign: positive = debit
      // balance (assets), negative = credit balance (liabilities, credit cards).
      const account = need(input.accountId, "Choose the account.");
      const amount = need(input.amountCents, "Enter the opening balance.");
      b.post("debit", account, amount);
      b.post("credit", sys.openingBalanceEquity, amount);
      totals = plainTotals(Math.abs(amount));
      break;
    }

    default: {
      const t: never = input.type;
      throw new PostingError(`Unknown transaction type ${t}`);
    }
  }

  // A voided transaction keeps its record but posts nothing.
  if (input.status === "voided") return { entries: [], totals };

  assertBalanced(b.entries);
  return { entries: b.entries, totals };
}

export function assertBalanced(entries: LedgerEntry[]) {
  let d = 0;
  let c = 0;
  for (const e of entries) {
    if (e.debitCents < 0 || e.creditCents < 0) throw new PostingError("Negative ledger amount");
    if ((e.debitCents === 0) === (e.creditCents === 0)) throw new PostingError("Entry must be exactly one side");
    d += e.debitCents;
    c += e.creditCents;
  }
  if (d !== c) throw new PostingError(`Out of balance by ${d - c} cents`);
}
