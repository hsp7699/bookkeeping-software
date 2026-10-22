import { writeFileSync } from "node:fs";
import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);

// expense with a split, new vendor inline
await p.goto(`${c}/expenses/new`);
await p.getByRole("combobox", { name: /^Payee/ }).fill("Delta Air");
await p.getByRole("option", { name: /Add new vendor/ }).click();
await p.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });
await p.getByLabel("Payment account").selectOption({ label: "Business Credit Card" });
await p.getByRole("combobox", { name: "Line 1 category" }).fill("Travel");
await p.getByRole("option", { name: /^Travel/ }).click();
await p.getByLabel("Line 1 amount").fill("412.30");
await p.getByRole("combobox", { name: "Line 2 category" }).fill("Meals");
await p.getByRole("option", { name: /^Meals/ }).click();
await p.getByLabel("Line 2 amount").fill("38.20");
await p.getByLabel("Line 2 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/expenses\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
console.log("· split expense saved");

// attach a receipt
writeFileSync("/tmp/receipt.pdf", "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
await p.locator('input[type="file"]').setInputFiles("/tmp/receipt.pdf");
await p.getByRole("link", { name: "receipt.pdf" }).waitFor();
console.log("· receipt attached");
await p.screenshot({ path: `${out}/expense-form.png`, fullPage: true });

// two bills from a vendor, then pay both at once
async function bill(amount, no) {
  await p.goto(`${c}/bills/new`);
  await p.getByRole("combobox", { name: /^Vendor/ }).fill("Landlord");
  const opt = p.getByRole("option", { name: /^Landlord LLC$/ });
  if (await opt.count()) await opt.click();
  else {
    await p.getByRole("option", { name: /Add new vendor/ }).click();
    await p.getByRole("dialog").getByRole("textbox", { name: /^Vendor display name/ }).fill("Landlord LLC");
    await p.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await p.getByRole("dialog").waitFor({ state: "detached" });
  }
  await p.getByLabel("Bill no.").fill(no);
  await p.getByRole("combobox", { name: "Line 1 category" }).fill("Rent");
  await p.getByRole("option", { name: /^Rent & Lease/ }).click();
  await p.getByLabel("Line 1 amount").fill(amount);
  await p.getByLabel("Line 1 amount").blur();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForURL(/bills\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
}
await bill("2000", "OCT-26");
await bill("2000", "NOV-26");
console.log("· two bills saved");

await p.goto(`${c}/vendors`);
expectEq(await p.locator("tr", { hasText: "Landlord LLC" }).locator("td").nth(3).textContent(), "$4,000.00", "vendor open balance");

await p.goto(`${c}/bills/pay`);
await p.getByRole("checkbox", { name: "Pay all bills" }).check();
await p.getByLabel("Payment account").selectOption({ label: "Business Checking" });
await p.getByLabel(/Starting check no/).fill("501");
await p.screenshot({ path: `${out}/pay-bills.png`, fullPage: true });
await p.getByRole("button", { name: /^Pay 2 bills/ }).click();
await p.getByText("Recorded 1 bill payment.").waitFor();
console.log("· paid two bills with one check");
await p.getByText("No open bills").waitFor();

await p.goto(`${c}/expenses`);
await p.screenshot({ path: `${out}/expenses-list.png` });
expectEq(await p.locator("tbody tr").count(), 4, "expense list rows");

// P&L expenses: travel 412.30 + meals 38.20 + rent 4000 = 4450.50
await p.goto(`${c}/reports/profit-and-loss`);
expectEq(await p.locator("tr", { hasText: "Total expenses" }).locator("td").textContent(), "$4,450.50", "total expenses");

// balances
await p.goto(`${c}/accounts`);
expectEq(await p.locator("tr", { hasText: "Business Credit Card" }).locator("td").nth(4).textContent(), "$450.50", "credit card balance owed");
expectEq(await p.locator("tr", { hasText: "Business Checking" }).locator("td").nth(4).textContent(), "-$4,000.00", "checking after rent check");
expectEq(await p.locator("tr", { hasText: "Accounts Payable" }).locator("td").nth(4).textContent(), "$0.00", "A/P after paying");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
