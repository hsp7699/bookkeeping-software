import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);
const d = p.getByRole("dialog");
const pillText = async () => (await p.locator("h1 + span").first().textContent())?.trim();

// estimate for 1,000
await p.goto(`${c}/estimates/new`, { waitUntil: "networkidle" });
await p.getByRole("combobox", { name: /^Customer/ }).fill("Northside Dental");
await p.getByRole("option", { name: /Add new customer/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByRole("combobox", { name: "Line 1 product or service" }).fill("Brand refresh");
await p.getByRole("option", { name: /Add new/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByLabel("Line 1 amount").fill("1000");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/estimates\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
const estUrl = p.url().split("?")[0];
expectEq(await pillText(), "Pending", "new estimate is pending");

// invoice 40% of it
await p.getByRole("link", { name: "Create invoice" }).click();
await p.getByText(/From estimate 1001/).waitFor();
await p.getByLabel("Line 1 amount").fill("400");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/invoices\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
await p.goto(estUrl);
expectEq(await pillText(), "Accepted", "estimate accepted after a partial invoice");
// the rest
await p.getByRole("link", { name: "Create invoice" }).click();
await p.getByText(/already invoiced, so these lines cover the remaining \$600\.00/).waitFor();
await p.screenshot({ path: `${out}/invoice-from-estimate.png`, fullPage: true });
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/invoices\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
await p.goto(estUrl);
expectEq(await pillText(), "Closed", "estimate closed once fully invoiced");
await p.goto(`${c}/estimates`);
await p.screenshot({ path: `${out}/estimates.png` });

// purchase order -> bill
await p.goto(`${c}/purchase-orders/new`, { waitUntil: "networkidle" });
await p.getByRole("combobox", { name: /^Vendor/ }).fill("Casco Print");
await p.getByRole("option", { name: /Add new vendor/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByRole("combobox", { name: "Line 1 category" }).fill("Cost of Goods");
await p.getByRole("option", { name: /^Cost of Goods Sold/ }).click();
await p.getByLabel("Line 1 amount").fill("238");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/purchase-orders\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
const poUrl = p.url().split("?")[0];
await p.getByRole("link", { name: "Create bill" }).click();
await p.getByText(/From purchase order/).waitFor();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/bills\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
await p.goto(poUrl);
expectEq(await pillText(), "Closed", "PO closed by the bill");

// billable expense -> invoice
await p.goto(`${c}/expenses/new`, { waitUntil: "networkidle" });
await p.getByLabel("Payment account").selectOption({ label: "Business Checking" });
await p.getByRole("combobox", { name: "Line 1 category" }).fill("Travel");
await p.getByRole("option", { name: /^Travel/ }).click();
await p.getByLabel("Line 1 amount").fill("312.40");
await p.getByLabel("Line 1 amount").blur();
await p.getByLabel("Line 1 billable").check();
await p.getByRole("combobox", { name: "Line 1 customer" }).fill("Northside");
await p.getByRole("option", { name: /Northside Dental/ }).click();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/expenses\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
await p.goto(`${c}/invoices/new`, { waitUntil: "networkidle" });
await p.getByRole("combobox", { name: /^Customer/ }).fill("Northside");
await p.getByRole("option", { name: /Northside Dental/ }).click();
await p.getByRole("region", { name: "Billable expenses" }).getByRole("button", { name: "Add" }).click();
await p.getByText("Billable expense", { exact: true }).waitFor();
expectEq(await p.getByLabel("Line 1 amount").inputValue(), "312.40", "billable expense added as a line");
await p.screenshot({ path: `${out}/invoice-billable.png`, fullPage: true });
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/invoices\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
await p.goto(`${c}/invoices/new`, { waitUntil: "networkidle" });
await p.getByRole("combobox", { name: /^Customer/ }).fill("Northside");
await p.getByRole("option", { name: /Northside Dental/ }).click();
await p.waitForTimeout(1500);
expectEq(await p.getByRole("region", { name: "Billable expenses" }).count(), 0, "billed expense no longer offered");

// sub-customer
await p.goto(`${c}/customers`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "New customer" }).click();
await d.getByRole("textbox", { name: /^Customer display name/ }).fill("Northside Dental: Falmouth office");
await d.getByLabel("Sub-customer of").selectOption({ label: "Northside Dental" });
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByRole("link", { name: "Northside Dental: Falmouth office" }).waitFor();
const pad = await p.locator("td", { has: p.getByRole("link", { name: "Northside Dental: Falmouth office" }) }).evaluate((el) => getComputedStyle(el).paddingLeft);
expectEq(pad, "36px", "sub-customer indented under its parent");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
