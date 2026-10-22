// Vertical slice: sign up -> company -> invoice (new customer + new item inline)
// -> partial payment -> P&L shows the income. Screenshots to argv[2].
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? ".";
const BASE = "http://localhost:3100";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const step = (s) => console.log("·", s);

const email = `slice+${Date.now()}@example.com`;
await p.goto(`${BASE}/signup`);
await p.getByLabel("Your name").fill("Pat Owner");
await p.getByLabel("Email").fill(email);
await p.getByLabel("Password").fill("correct horse battery");
await p.getByRole("button", { name: "Create account" }).click();
await p.waitForURL("**/setup", { timeout: 60000 });
await p.getByLabel("Business name").fill("Harbor Studio LLC");
await p.getByRole("button", { name: "Create company" }).click();
await p.waitForURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 60000 });
const companyUrl = p.url();
step("company created");

await p.goto(`${companyUrl}/invoices/new`);
// customer via "+ Add new"
await p.getByRole("combobox", { name: "Customer" }).fill("Northside Dental");
await p.getByRole("option", { name: /Add new customer/ }).click();
await p.getByLabel("Email", { exact: true }).last().fill("ap@northside.example");
await p.getByRole("button", { name: "Save", exact: true }).last().click();
await p.getByRole("dialog").waitFor({ state: "detached" });
step("customer added inline");

// line 1: new service via "+ Add new"
await p.getByRole("combobox", { name: "Line 1 product or service" }).fill("Brand strategy");
await p.getByRole("option", { name: /Add new/ }).click();
const dlg = p.getByRole("dialog");
await dlg.getByLabel("Price / rate").fill("1500");
await dlg.getByLabel("Description on sales forms").fill("Positioning workshop and brand brief");
await dlg.getByRole("button", { name: "Save", exact: true }).click();
await dlg.waitFor({ state: "detached" });
await p.getByLabel("Line 1 quantity").fill("2");
step("item added inline, qty 2");

// line 2: same service, custom amount
await p.getByRole("combobox", { name: "Line 2 product or service" }).click();
await p.getByRole("option", { name: /Brand strategy/ }).click();
await p.getByLabel("Line 2 description").fill("Follow-up session");
await p.getByLabel("Line 2 amount").fill("250");
await p.getByLabel("Line 2 amount").blur();
await p.getByLabel("Discount amount").fill("50");
await p.getByLabel("Discount amount").blur();
await p.screenshot({ path: `${out}/invoice-form.png`, fullPage: true });
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/invoices\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
const balance = await p.locator("text=Balance due").first().locator("xpath=following-sibling::p").textContent();
step(`invoice saved, balance due ${balance}`);
if (balance?.trim() !== "$3,200.00") throw new Error(`expected $3,200.00, got ${balance}`);

// partial payment
await p.getByRole("link", { name: "Receive payment" }).click();
await p.waitForURL(/payments\/new/);
await p.getByRole("checkbox", { name: /Pay invoice 1001/ }).waitFor();
await p.getByRole("textbox", { name: /^Amount received/ }).fill("1000");
await p.getByRole("textbox", { name: /^Amount received/ }).blur();
await p.screenshot({ path: `${out}/payment-form.png`, fullPage: true });
await p.getByRole("button", { name: "Save and close" }).click();
await p.waitForURL(/\/invoices$/, { timeout: 60000 });
await p.getByText("Partially paid").waitFor();
await p.screenshot({ path: `${out}/invoices-list.png` });
step("payment saved, invoice partially paid");

await p.goto(`${companyUrl}/reports/profit-and-loss`);
await p.getByText("Net income").waitFor();
const net = await p.locator("tr", { hasText: "Net income" }).locator("td").textContent();
step(`P&L accrual net income ${net}`);
if (net?.trim() !== "$3,200.00") throw new Error(`expected accrual net income $3,200.00, got ${net}`);
await p.screenshot({ path: `${out}/pnl-accrual.png`, fullPage: true });
await p.getByLabel("Cash").check();
await p.waitForURL(/basis=cash/);
await p.getByText("Cash basis").waitFor();
const cash = await p.locator("tr", { hasText: "Net income" }).locator("td").textContent();
step(`P&L cash net income ${cash}`);
// $1,000 of a $3,200 invoice: income 3250 and discount -50 scaled by 1000/3200
if (cash?.trim() !== "$1,000.00") throw new Error(`expected cash net income $1,000.00, got ${cash}`);

await p.goto(`${companyUrl}/customers`);
await p.screenshot({ path: `${out}/customers.png` });
await p.goto(`${companyUrl}/accounts`);
await p.screenshot({ path: `${out}/accounts.png`, fullPage: true });

console.log("OK", companyUrl, errors.length ? `\nPAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
await b.close();
