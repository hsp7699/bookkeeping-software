import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);
const d = p.getByRole("dialog");

// opening balance 1,000 on checking, and three expenses
await p.goto(`${c}/accounts`);
await p.getByRole("button", { name: "New account" }).click();
await d.getByRole("textbox", { name: /^Account name/ }).fill("Operating");
await d.getByLabel("Account type").selectOption("bank");
await d.getByLabel("Opening balance").fill("1000");
await d.getByLabel("As of").fill("2026-09-01");
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
for (const [date, amt] of [["2026-09-05", "25"], ["2026-09-12", "100"], ["2026-10-02", "60"]]) {
  await p.goto(`${c}/expenses/new`, { waitUntil: "networkidle" });
  await p.getByLabel("Payment account").selectOption({ label: "Operating" });
  await p.getByLabel("Payment date").fill(date);
  await p.getByRole("combobox", { name: "Line 1 category" }).fill("Office");
  await p.getByRole("option", { name: /^Office Supplies/ }).click();
  await p.getByLabel("Line 1 amount").fill(amt);
  await p.getByLabel("Line 1 amount").blur();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForURL(/\?saved=1/, { timeout: 60000 });
}
console.log("· setup: opening balance and three expenses");

// statement through Sep 30 shows 875.00 (1000 − 25 − 100)
await p.goto(`${c}/reconcile`, { waitUntil: "networkidle" });
await p.getByLabel("Account").selectOption({ label: "Operating" });
await p.getByLabel("Statement ending date").fill("2026-09-30");
await p.getByLabel("Statement ending balance").fill("875");
await p.getByLabel("Statement ending balance").blur();
await p.getByRole("button", { name: "Start reconciling" }).click();
await p.waitForURL(/reconcile\/[0-9a-f-]{36}$/, { timeout: 60000 });
expectEq(await p.locator("tbody tr").count(), 3, "September items shown (October excluded)");
await p.getByRole("checkbox", { name: "Tick all shown" }).check();
await p.getByText("$0.00").first().waitFor();
const diff = await p.locator("[aria-live=polite] p").nth(1).textContent();
expectEq(diff, "$0.00", "difference after ticking all");
await p.screenshot({ path: `${out}/reconcile.png`, fullPage: true });
await p.getByRole("button", { name: "Finish now" }).click();
await p.getByText(/Reconciled\. These transactions are now locked/).waitFor();
console.log("· reconciled September");
await p.screenshot({ path: `${out}/reconcile-report.png`, fullPage: true });

// the register shows R; editing a reconciled expense is refused
await p.goto(`${c}/expenses`);
await p.locator("tr", { hasText: "09/12/2026" }).getByRole("link", { name: "Expense" }).click();
await p.getByLabel("Line 1 amount").fill("101");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.getByText(/undo the reconciliation first/).waitFor();
console.log("· editing a reconciled expense is refused with a way forward");

// next statement starts at 875
await p.goto(`${c}/reconcile`, { waitUntil: "networkidle" });
await p.getByLabel("Account").selectOption({ label: "Operating" });
await p.getByText(/ending at \$875\.00/).waitFor();
console.log("· next statement starts from $875.00");

// undo and the edit goes through
await p.getByRole("link", { name: "View report" }).click();
await p.getByRole("button", { name: "Undo this reconciliation" }).click();
await p.getByRole("alertdialog").getByRole("button", { name: "Undo" }).click();
await p.waitForURL(/\/reconcile$/);
await p.getByText("Undone").waitFor();
console.log("· undo worked");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
