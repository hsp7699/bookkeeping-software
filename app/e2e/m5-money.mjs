import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);

// a savings account to transfer to
await p.goto(`${c}/accounts`);
await p.getByRole("button", { name: "New account" }).click();
const d = p.getByRole("dialog");
await d.getByRole("textbox", { name: /^Account name/ }).fill("Business Savings");
await d.getByLabel("Account type").selectOption("bank");
await d.getByLabel("Detail type").selectOption("savings");
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });

// two sales receipts into Undeposited Funds
for (const amt of ["300", "450"]) {
  await p.goto(`${c}/sales-receipts/new`);
  await p.getByRole("combobox", { name: /^Customer/ }).fill("Walk-in");
  const opt = p.getByRole("option", { name: /^Walk-in$/ });
  if (await opt.count()) await opt.click();
  else {
    await p.getByRole("option", { name: /Add new customer/ }).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await d.waitFor({ state: "detached" });
  }
  await p.getByRole("combobox", { name: "Line 1 product or service" }).fill("Consult");
  const it = p.getByRole("option", { name: /^Consult$/ });
  if (await it.count()) await it.click();
  else {
    await p.getByRole("option", { name: /Add new/ }).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await d.waitFor({ state: "detached" });
  }
  await p.getByLabel("Line 1 amount").fill(amt);
  await p.getByLabel("Line 1 amount").blur();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForURL(/\?saved=1/, { timeout: 60000 });
}
console.log("· two sales receipts in Undeposited Funds");

// deposit both with a $5 fee
await p.goto(`${c}/deposits/new`);
await p.getByRole("checkbox", { name: "Select all payments" }).check();
await p.getByRole("combobox", { name: "Line 1 category" }).fill("Bank Fees");
await p.getByRole("option", { name: /^Bank Fees/ }).click();
await p.getByLabel("Line 1 amount").fill("-5");
await p.getByLabel("Line 1 amount").blur();
expectEq(await p.locator("text=Deposit total").locator("xpath=following-sibling::p").textContent(), "$745.00", "deposit total");
await p.screenshot({ path: `${out}/deposit-form.png`, fullPage: true });
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/deposits\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });

// transfer 500 to savings
await p.goto(`${c}/transfers/new`);
await p.getByLabel("Transfer funds from").selectOption({ label: "Business Checking" });
await p.getByLabel("Transfer funds to").selectOption({ label: "Business Savings" });
await p.getByLabel("Transfer amount").fill("500");
await p.getByLabel("Transfer amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/transfers\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
console.log("· transfer saved");

// journal entry: unbalanced is blocked, balanced saves
await p.goto(`${c}/journal-entries/new`);
await p.getByRole("combobox", { name: "Line 1 account" }).fill("Depreciation");
await p.getByRole("option", { name: /^Depreciation/ }).first().click();
await p.getByLabel("Line 1 debit").fill("100");
await p.getByRole("combobox", { name: "Line 2 account" }).fill("Accumulated");
await p.getByRole("option", { name: /^Accumulated Depreciation/ }).click();
await p.getByLabel("Line 2 credit").fill("90");
await p.getByLabel("Line 2 credit").blur();
await p.getByText("Off by $10.00").waitFor();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.getByText(/off by \$10\.00/).waitFor();
await p.getByLabel("Line 2 credit").fill("100");
await p.getByLabel("Line 2 credit").blur();
await p.getByText("Balanced").waitFor();
await p.screenshot({ path: `${out}/journal-entry.png` });
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/journal-entries\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
console.log("· journal entry: unbalanced blocked, balanced saved");

await p.goto(`${c}/accounts`);
const bal = async (name) => p.locator("tr", { has: p.locator("td", { hasText: new RegExp(`^${name}`) }) }).first().locator("td").nth(4).textContent();
expectEq(await bal("Business Checking"), "$245.00", "checking: 745 deposit − 500 transfer");
expectEq(await bal("Business Savings"), "$500.00", "savings");
expectEq(await bal("Undeposited Funds"), "$0.00", "undeposited funds emptied");

// close the books, then try to edit a closed-period transaction
await p.goto(`${c}/settings`, { waitUntil: "networkidle" });
const today = new Date();
await p.getByLabel("Closing date").fill(today.toISOString().slice(0, 10));
await p.getByLabel("Password", { exact: true }).fill("closed-2026");
await p.getByRole("button", { name: "Save closing date" }).click();
await p.getByText("Books closed.").waitFor();
await p.screenshot({ path: `${out}/settings.png`, fullPage: true });
await p.goto(`${c}/transfers/new`);
await p.getByLabel("Transfer amount").fill("1");
await p.getByLabel("Transfer amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.getByText(/closed period/).waitFor();
await p.getByLabel("Close-books password").fill("closed-2026");
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/transfers\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
console.log("· closed period blocked, then allowed with the password");
await p.goto(`${c}/audit`);
await p.getByText("Changed closed period").waitFor();
console.log("· override recorded in the audit log");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
