// Creates a demo login and company with six months of realistic activity,
// all through the real save pipeline.
// Usage: npm run seed:demo   (sign in as demo@example.com / demo-books-2026)
import { hash } from "@node-rs/argon2";
import { one, pool, query, tx } from "@/db";
import { createCompany } from "@/lib/company";
import { addDays } from "@/lib/dates";
import { saveTransaction } from "@/lib/txn/save";

const EMAIL = "demo@example.com";

async function main() {
  const existing = await one<{ id: string }>("select id from users where email = $1", [EMAIL]);
  if (existing) {
    console.log(`${EMAIL} already exists; delete it first to re-seed.`);
    return;
  }
  const user = await one<{ id: string }>("insert into users (email, name, password_hash) values ($1, 'Demo Owner', $2) returning id", [EMAIL, await hash("demo-books-2026")]);
  const userId = user!.id;
  const companyId = await tx((db) => createCompany(db, userId, { name: "Harbor Studio (demo)", entityType: "llc_single", fiscalYearStartMonth: 1, accountingMethod: "accrual", timezone: "America/New_York" }));
  await query("update companies set email = 'hello@harbor.example', address = $2 where id = $1", [companyId, JSON.stringify({ line1: "12 Water St", city: "Portland", state: "ME", zip: "04101" })]);
  const acct: Record<string, string> = {};
  for (const a of await query<{ id: string; name: string }>("select id, name from accounts where company_id = $1", [companyId])) acct[a.name] = a.id;
  const contact = async (kind: string, name: string, email?: string) =>
    (await one<{ id: string }>("insert into contacts (company_id, kind, display_name, emails) values ($1, $2, $3, $4) returning id", [companyId, kind, name, email ? [email] : []]))!.id;
  const customers = [await contact("customer", "Northside Dental", "ap@northside.example"), await contact("customer", "Harbor Coffee", "owner@harborcoffee.example"), await contact("customer", "Pine & Co Realty")];
  const landlord = await contact("vendor", "Wharf Properties");
  const adobe = await contact("vendor", "Adobe");
  const printer = await contact("vendor", "Casco Print Shop");
  const item = async (name: string, price: number, account: string) =>
    (await one<{ id: string }>("insert into items (company_id, name, type, sales_price_cents, income_account_id) values ($1, $2, 'service', $3, $4) returning id", [companyId, name, price, acct[account]]))!.id;
  const design = await item("Design hours", 12000, "Services");
  const retainer = await item("Monthly retainer", 150000, "Services");
  const prints = await item("Print production", 0, "Sales");

  const save = (i: object) => saveTransaction(companyId, userId, i);
  const today = (await one<{ d: string }>("select (now() at time zone 'America/New_York')::date::text as d"))!.d;
  const [ty, tm] = today.split("-").map(Number);
  const month = (back: number, day: number) => new Date(Date.UTC(ty, tm - 1 - back, day)).toISOString().slice(0, 10);

  await save({ type: "opening_balance", txnDate: month(6, 1), accountId: acct["Business Checking"], amountCents: 1850000, memo: "Opening balance" });
  for (let back = 5; back >= 0; back--) {
    // retainer invoice each month, paid ~2 weeks later (except the current month)
    const r = await save({ type: "invoice", contactId: customers[0], txnDate: month(back, 1), dueDate: month(back, 15), lines: [{ itemId: retainer, qty: 1, rateCents: 150000, amountCents: 150000 }] });
    if (back > 0) await save({ type: "payment", contactId: customers[0], txnDate: month(back, 14), accountId: acct["Business Checking"], amountCents: 150000, applications: [{ txnId: r.id, amountCents: 150000 }] });
    // project work for the coffee shop, paid partly late
    const hours = 8 + ((back * 7) % 11);
    const p = await save({ type: "invoice", contactId: customers[1], txnDate: month(back, 10), dueDate: month(back, 25), lines: [{ itemId: design, qty: hours, rateCents: 12000, amountCents: hours * 12000 }] });
    if (back > 1) await save({ type: "payment", contactId: customers[1], txnDate: month(back - 1, 3), amountCents: hours * 12000, applications: [{ txnId: p.id, amountCents: hours * 12000 }] });
    // walk-in print jobs, cash sale
    if (back % 2 === 0) await save({ type: "sales_receipt", contactId: customers[2], txnDate: month(back, 18), lines: [{ itemId: prints, qty: 1, rateCents: 42000, amountCents: 42000 }] });
    // rent bill, paid
    const rent = await save({ type: "bill", contactId: landlord, txnDate: month(back, 1), dueDate: month(back, 5), number: `R-${back}`, lines: [{ accountId: acct["Rent & Lease"], amountCents: 180000 }] });
    if (back > 0) await save({ type: "bill_payment", contactId: landlord, txnDate: month(back, 4), accountId: acct["Business Checking"], amountCents: 180000, applications: [{ txnId: rent.id, amountCents: 180000 }] });
    // software and printing on the card, meals
    await save({ type: "expense", contactId: adobe, txnDate: month(back, 6), accountId: acct["Business Credit Card"], lines: [{ accountId: acct["Office Supplies & Software"], amountCents: 8999 }] });
    if (back % 2 === 0) {
      await save({ type: "expense", contactId: printer, txnDate: month(back, 17), accountId: acct["Business Credit Card"], lines: [{ accountId: acct["Cost of Goods Sold"], amountCents: 16500 }] });
    }
    await save({ type: "expense", txnDate: month(back, 21), accountId: acct["Business Credit Card"], lines: [{ accountId: acct["Meals"], amountCents: 4200 + back * 310 }, { accountId: acct["Travel"], amountCents: back === 3 ? 61200 : 0 }].filter((l) => l.amountCents > 0) });
    await save({ type: "expense", txnDate: month(back, 27), accountId: acct["Business Checking"], lines: [{ accountId: acct["Utilities"], amountCents: 11200 + back * 450 }] });
    // pay the card off from checking each month
    if (back > 0) await save({ type: "transfer", txnDate: month(back, 26), accountId: acct["Business Credit Card"], fromAccountId: acct["Business Checking"], amountCents: 20000 });
  }
  // an overdue invoice and an open bill
  await save({ type: "invoice", contactId: customers[2], txnDate: addDays(today, -75), dueDate: addDays(today, -45), lines: [{ itemId: design, qty: 6, rateCents: 12000, amountCents: 72000 }] });
  await save({ type: "bill", contactId: printer, txnDate: addDays(today, -3), dueDate: addDays(today, 4), number: "CP-2207", lines: [{ accountId: acct["Cost of Goods Sold"], amountCents: 23800 }] });
  console.log(`Seeded. Sign in as ${EMAIL} / demo-books-2026`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
