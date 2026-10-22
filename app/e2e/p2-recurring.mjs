import { BASE, expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);
const d = p.getByRole("dialog");
const nyDay = (offset) => {
  const t = new Date(Date.now() + offset * 86400000);
  return t.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
};

// an invoice for 2,500
await p.goto(`${c}/invoices/new`, { waitUntil: "networkidle" });
await p.getByRole("combobox", { name: /^Customer/ }).fill("Retainer Co");
await p.getByRole("option", { name: /Add new customer/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByRole("combobox", { name: "Line 1 product or service" }).fill("Monthly retainer");
await p.getByRole("option", { name: /Add new/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByLabel("Line 1 amount").fill("2500");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/invoices\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
const invUrl = p.url().split("?")[0];

// make it a monthly reminder that's already due
await p.getByRole("button", { name: "More" }).click();
await p.getByRole("menuitem", { name: "Make recurring" }).click();
expectEq(await d.getByLabel(/^Template name/).inputValue(), "Retainer Co invoice", "template name suggested");
await d.getByLabel("Remind me").check();
await d.getByLabel("On day").selectOption({ label: "Same day as the start date" });
await d.getByLabel(/^Start date/).fill(nyDay(-1));
await p.screenshot({ path: `${out}/make-recurring.png` });
await d.getByRole("button", { name: "Save template" }).click();
await p.waitForURL(/\/recurring$/, { timeout: 60000 });
const row = p.getByRole("row", { name: /Retainer Co invoice/ });
await row.getByText("Ready").waitFor();
expectEq(await row.getByRole("cell").nth(3).textContent(), "Every month", "schedule shown");
await p.getByText(/1 reminder is ready/).waitFor();
console.log("· reminder is ready on the Recurring page");
await p.screenshot({ path: `${out}/recurring.png` });

// create it now
await row.getByRole("button", { name: /Actions for/ }).click();
await p.getByRole("menuitem", { name: "Create now" }).click();
await p.waitForURL((u) => /invoices\/[0-9a-f-]{36}$/.test(u.pathname) && !u.href.startsWith(invUrl), { timeout: 60000 });
await p.getByText("$2,500.00").first().waitFor();
console.log("· Create now made a new $2,500 invoice");
await p.goto(`${c}/recurring`, { waitUntil: "networkidle" });
await row.getByText(/1 created/).waitFor();
expectEq(await row.getByText("Ready").count(), 0, "no longer ready after creating");

// pause and resume
await row.getByRole("button", { name: /Actions for/ }).click();
await p.getByRole("menuitem", { name: "Pause" }).click();
await row.getByText("Paused").waitFor();
await row.getByRole("button", { name: /Actions for/ }).click();
await p.getByRole("menuitem", { name: "Resume" }).click();
await row.getByText("Paused").waitFor({ state: "detached" });
console.log("· paused and resumed");

// customer statement: two invoices, 5,000 due
await p.goto(`${c}/customers`, { waitUntil: "networkidle" });
await p.getByRole("link", { name: "Retainer Co" }).click();
await p.getByRole("link", { name: "Statement" }).click();
await p.waitForURL(/statement$/);
const due = async () => (await p.getByRole("definition").last().textContent())?.trim();
expectEq(await due(), "$5,000.00", "balance-forward statement amount due");
await p.getByLabel("Type").selectOption("open_item");
await p.getByRole("button", { name: "Update" }).click();
await p.waitForURL(/kind=open_item/);
expectEq(await due(), "$5,000.00", "open-item statement amount due");
await p.screenshot({ path: `${out}/statement.png`, fullPage: true });
const pdfHref = await p.getByRole("link", { name: "Download PDF" }).getAttribute("href");
const pdf = await p.request.get(BASE + pdfHref);
expectEq(pdf.headers()["content-type"], "application/pdf", "statement PDF");

// invoice appearance and reminders
await p.goto(`${c}/settings`, { waitUntil: "networkidle" });
const look = p.locator("section, div").filter({ has: p.getByRole("heading", { name: "Invoice appearance" }) }).last();
await look.getByRole("textbox", { name: "Accent colour", exact: true }).fill("#ffee00");
await look.getByRole("button", { name: "Save appearance" }).click();
await look.getByText(/too light to read/).waitFor();
console.log("· a too-light accent colour is refused");
await look.getByRole("textbox", { name: "Accent colour", exact: true }).fill("#1f5f8b");
await look.getByLabel("Footer").fill("Pay by ACH to account 0000. Thank you!");
await look.getByRole("button", { name: "Save appearance" }).click();
await look.getByText(/Saved. New PDFs use this look/).waitFor();
console.log("· appearance saved");
const rem = p.locator("div").filter({ has: p.getByRole("heading", { name: "Overdue reminders" }) }).last();
await rem.getByLabel("Send overdue reminders automatically").check();
await rem.getByLabel("Days after the due date").fill("3, 14, 30");
await rem.getByRole("button", { name: "Save reminders" }).click();
await rem.getByText("Reminders are on.").waitFor();
console.log("· reminders on");
const inv = await p.request.get(`${invUrl}/pdf`);
expectEq(inv.headers()["content-type"], "application/pdf", "branded invoice PDF renders");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
