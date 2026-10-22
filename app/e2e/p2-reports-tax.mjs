import { BASE, expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();

// new reports on the demo company
await p.goto(`${BASE}/login`);
await p.getByLabel("Email").fill("demo@example.com");
await p.getByLabel("Password").fill("demo-books-2026");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 180000 });
const demo = p.url();
const money = (s) => Number(String(s).replace(/[$,]/g, ""));
await p.goto(`${demo}/reports/trial-balance`);
const tot = p.locator("tr", { hasText: /^Total/ }).last().locator("td");
expectEq(await tot.nth(0).textContent(), await tot.nth(1).textContent(), "trial balance debits = credits");
await p.screenshot({ path: `${out}/rep-tb.png`, fullPage: true });
await p.goto(`${demo}/reports/cash-flow?range=fy_to_date`);
const change = money(await p.locator("tr", { hasText: "Net change in cash" }).locator("td").textContent());
const s0 = money(await p.locator("tr", { hasText: "Cash at the start" }).locator("td").textContent());
const s1 = money(await p.locator("tr", { hasText: "Cash at the end" }).locator("td").textContent());
expectEq((s0 + change).toFixed(2), s1.toFixed(2), "cash flow ties out");
await p.screenshot({ path: `${out}/rep-cashflow.png`, fullPage: true });
for (const r of ["sales-by-customer", "sales-by-product", "expenses-by-vendor", "vendor-1099", "profit-and-loss?compare=prev_period&range=this_quarter"]) {
  await p.goto(`${demo}/reports/${r}`);
  await p.locator("main table, main p").first().waitFor();
  console.log(`· ${r} renders`);
}
await p.screenshot({ path: `${out}/rep-pnl-compare.png`, fullPage: true });
const csv = await p.request.get(`${demo}/reports/trial-balance/csv`);
expectEq((await csv.text()).includes("Total"), true, "trial balance CSV");

// sales tax flow on a fresh company
await p.goto(`${BASE}/login`);
const c = await newCompany(p);
await p.goto(`${c}/settings`, { waitUntil: "networkidle" });
await p.getByLabel("Rate name").fill("Maine");
await p.getByLabel("Tax agency").fill("Maine Revenue Services");
await p.getByLabel("Rate (%)").fill("5.5");
await p.getByRole("button", { name: "Add rate" }).click();
await p.getByText("5.50%").waitFor();
await p.goto(`${c}/invoices/new`);
await p.getByRole("combobox", { name: /^Customer/ }).fill("Taxable Co");
await p.getByRole("option", { name: /Add new customer/ }).click();
await p.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });
await p.getByRole("combobox", { name: "Line 1 product or service" }).fill("Widget");
await p.getByRole("option", { name: /Add new/ }).click();
await p.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });
await p.getByLabel("Line 1 amount").fill("200");
await p.getByLabel("Line 1 amount").blur();
await p.getByLabel("Sales tax rate").selectOption({ label: "Maine (5.50%)" });
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/\?saved=1/, { timeout: 60000 });
await p.goto(`${c}/taxes?range=this_quarter`, { waitUntil: "networkidle" });
await p.getByRole("cell", { name: "$11.00" }).waitFor();
console.log("· tax charged shows on the sales tax page");
await p.getByRole("button", { name: "Record tax payment" }).click();
await p.getByRole("dialog").getByRole("button", { name: "Save payment" }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });
await p.reload();
const owed = await p.locator("text=Owed at the end").locator("xpath=following-sibling::p").textContent();
expectEq(owed, "$0.00", "nothing owed after paying the suggested amount");
await p.screenshot({ path: `${out}/sales-tax.png`, fullPage: true });

// tax-exempt customer: the rate is locked off
await p.goto(`${c}/customers`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "New customer" }).click();
await p.getByRole("dialog").getByRole("textbox", { name: /^Customer display name/ }).fill("Nonprofit Org");
await p.getByRole("dialog").getByLabel("Tax exempt").check();
await p.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });
await p.goto(`${c}/invoices/new`);
await p.getByRole("combobox", { name: /^Customer/ }).fill("Nonprofit");
await p.getByRole("option", { name: /Nonprofit Org/ }).click();
expectEq(await p.getByLabel("Sales tax rate").isDisabled(), true, "tax rate disabled for an exempt customer");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
