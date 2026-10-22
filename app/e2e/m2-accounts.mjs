import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);

await p.goto(`${c}/accounts`);
await p.getByRole("button", { name: "New account" }).click();
const d = p.getByRole("dialog");
await d.getByRole("textbox", { name: /^Account name/ }).fill("Business Savings");
await d.getByLabel("Account type").selectOption("bank");
await d.getByLabel("Detail type").selectOption("savings");
await d.getByLabel("Opening balance").fill("5000");
await d.getByLabel("Opening balance").blur();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
const row = p.locator("tr", { hasText: "Business Savings" });
expectEq(await row.locator("td").nth(4).textContent(), "$5,000.00", "savings balance after opening balance");
const obe = p.locator("tr", { hasText: "Opening Balance Equity" });
expectEq(await obe.locator("td").nth(4).textContent(), "$5,000.00", "opening balance equity");

// sub-account
await p.getByRole("button", { name: "New account" }).click();
await d.getByRole("textbox", { name: /^Account name/ }).fill("Software");
await d.getByLabel("Account type").selectOption("expense");
await d.getByLabel("Make it a sub-account of").selectOption({ label: "Office Supplies & Software" });
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.locator("td", { hasText: /^Software$/ }).waitFor({ timeout: 10000 });
console.log("· sub-account shows under its parent without a reload");

// a system account can't be made inactive
await p.getByRole("button", { name: "More actions for Undeposited Funds" }).click();
await p.getByRole("menuitem", { name: "Make inactive" }).click();
await p.getByText("can't be made inactive").waitFor();
console.log("· system account protected");
await p.screenshot({ path: `${out}/accounts.png`, fullPage: true });

await row.getByRole("link", { name: "View register" }).click();
await p.getByText("Business Savings register").waitFor();
expectEq(await p.locator("tbody tr").first().locator("td").last().textContent(), "$5,000.00", "register running balance");
await p.screenshot({ path: `${out}/register.png` });

await p.goto(`${c}/audit`);
await p.getByText("Opening balance").first().waitFor();
await p.screenshot({ path: `${out}/audit.png` });
console.log("· audit log lists the changes");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
