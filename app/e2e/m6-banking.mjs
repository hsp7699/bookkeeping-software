import { fileURLToPath } from "node:url";
import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const csv = fileURLToPath(new URL("./fixtures-bank.csv", import.meta.url));
const { browser, page: p, errors } = await start();
const c = await newCompany(p);
const d = p.getByRole("dialog");

// setup: an open invoice for 1,200, an expense already entered by hand, a savings account
await p.goto(`${c}/invoices/new`);
await p.getByRole("combobox", { name: /^Customer/ }).fill("Northside Dental");
await p.getByRole("option", { name: /Add new customer/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByRole("combobox", { name: "Line 1 product or service" }).fill("Retainer");
await p.getByRole("option", { name: /Add new/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByLabel("Line 1 amount").fill("1200");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/\?saved=1/, { timeout: 60000 });

await p.goto(`${c}/expenses/new`);
await p.getByLabel("Payment account").selectOption({ label: "Business Checking" });
await p.getByLabel("Payment date").fill("2026-10-03");
await p.getByRole("combobox", { name: "Line 1 category" }).fill("Office");
await p.getByRole("option", { name: /^Office Supplies/ }).click();
await p.getByLabel("Line 1 amount").fill("49.99");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/\?saved=1/, { timeout: 60000 });

await p.goto(`${c}/accounts`);
await p.getByRole("button", { name: "New account" }).click();
await d.getByRole("textbox", { name: /^Account name/ }).fill("Business Savings");
await d.getByLabel("Account type").selectOption("bank");
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
console.log("· setup done");

// connect checking and import
await p.goto(`${c}/banking`, { waitUntil: "networkidle" });
await p.getByLabel("Account in your books").selectOption({ label: "Business Checking" });
await p.getByRole("button", { name: "Use this account" }).click();
await p.getByRole("button", { name: "Import file" }).waitFor();
async function importFile() {
  await p.getByRole("button", { name: "Import file" }).click();
  await d.getByLabel("Bank file").setInputFiles(csv);
  await d.getByText(/6 transactions found/).waitFor();
  await d.getByRole("button", { name: /^Import 6/ }).click();
  const msg = await d.getByRole("status").textContent();
  await d.getByRole("button", { name: "Done" }).click();
  return msg;
}
expectEq(await importFile(), "Imported 6 new transactions.", "first import");
expectEq(await importFile(), "Imported 0 new transactions, skipped 6 already imported.", "re-import skips duplicates");
await p.screenshot({ path: `${out}/bank-feed.png`, fullPage: true });

const row = (text) => p.locator("tbody tr", { hasText: text }).first();

// the deposit matches the open invoice
await row("NORTHSIDE DENTAL").getByText("1 match found").waitFor();
await row("NORTHSIDE DENTAL").getByRole("button", { name: "Match" }).click();
await row("NORTHSIDE DENTAL").waitFor({ state: "detached" });
console.log("· deposit matched to the open invoice");

// the Adobe charge matches the expense already entered
await row("ADOBE").getByRole("button", { name: "Match" }).click();
await row("ADOBE").waitFor({ state: "detached" });
console.log("· charge matched to the existing expense");

// categorize the first Starbucks by hand
await row("STARBUCKS").getByRole("button", { name: "Review" }).click();
await p.getByRole("combobox", { name: "Line 1 category" }).fill("Meals");
await p.getByRole("option", { name: /^Meals/ }).click();
await p.screenshot({ path: `${out}/bank-review-panel.png`, fullPage: true });
await p.getByRole("button", { name: "Add", exact: true }).last().click();
await p.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
console.log("· categorized one coffee as Meals");

// a rule for the other one
await row("STARBUCKS").getByRole("button", { name: "Review" }).click();
await p.getByRole("button", { name: "Create rule" }).click();
await d.getByRole("combobox", { name: /^Category/ }).fill("Meals");
await p.getByRole("option", { name: /^Meals/ }).click();
await d.getByRole("button", { name: "Save rule" }).click();
await p.getByText(/Rule saved/).waitFor();
await row("STARBUCKS").getByText(/rule:/).waitFor();
console.log("· rule suggests Meals for the second coffee");
await p.getByRole("checkbox", { name: "Select STARBUCKS #1234" }).check();
await p.getByRole("button", { name: "Accept suggestions" }).click();
await p.getByText(/Accepted 1/).waitFor();
console.log("· accepted the rule suggestion in bulk");

// transfer to savings
await row("TRANSFER TO SAVINGS").getByRole("button", { name: "Review" }).click();
await p.getByLabel("Record as transfer").check();
await p.getByLabel("Transferred to").selectOption({ label: "Business Savings" });
await p.getByRole("button", { name: "Add", exact: true }).last().click();
await row("TRANSFER TO SAVINGS").waitFor({ state: "detached" });
console.log("· recorded a transfer to savings");

// exclude fuel
await row("SHELL").getByRole("button", { name: "Review" }).click();
await p.getByRole("button", { name: "Exclude", exact: true }).last().click();
await p.getByText("Nothing to review").waitFor();
console.log("· excluded the last one; nothing left to review");

await p.getByRole("link", { name: "Categorized" }).click();
await p.getByText("Matched: Expense").waitFor();
expectEq(await p.locator("tbody tr").count(), 5, "categorized rows");
await p.screenshot({ path: `${out}/bank-categorized.png`, fullPage: true });

// undo the transfer and redo it
await row("TRANSFER TO SAVINGS").getByRole("button", { name: "Undo" }).click();
await p.getByText("Moved back to For review.").waitFor();
await p.waitForFunction(() => document.querySelectorAll("tbody tr").length === 4);
expectEq(await p.locator("tbody tr").count(), 4, "after undo");
console.log("· undo moved the transfer back to review and removed it from the books");

await p.goto(`${c}/accounts`);
const bal = async (name) => p.locator("tr", { has: p.locator("td", { hasText: new RegExp(`^${name}`) }) }).first().locator("td").nth(4).textContent();
// +1200 − 5.75 − 5.75 − 49.99 (no transfer after undo)
expectEq(await bal("Business Checking"), "$1,138.51", "checking balance in books");
expectEq(await bal("Business Savings"), "$0.00", "savings after undo");
expectEq(await bal("Accounts Receivable"), "$0.00", "invoice paid by the matched deposit");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
