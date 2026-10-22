import { fileURLToPath } from "node:url";
import { BASE, expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const receiptPng = fileURLToPath(new URL("./fixtures-receipt.png", import.meta.url));
const { browser, page: p, errors } = await start();
const c = await newCompany(p);
const d = p.getByRole("dialog");
const today = await p.evaluate(() => new Date().toLocaleDateString("en-CA"));

// ---- budgets
await p.goto(`${c}/budgets`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "New budget" }).click();
await d.getByRole("button", { name: "Create budget" }).click();
await p.waitForURL(/budgets\/[0-9a-f-]{36}$/, { timeout: 60000 });
await p.getByLabel("Services total", { exact: true }).fill("120000");
await p.getByLabel("Services total", { exact: true }).blur();
expectEq(await p.getByLabel(/^Services (Jan|Oct)/).first().inputValue(), "10,000.00", "a yearly total spreads evenly");
await p.getByLabel("Rent & Lease total", { exact: true }).fill("24000");
await p.getByLabel("Rent & Lease total", { exact: true }).blur();
expectEq(await p.getByTestId("budget-net").textContent(), "$96,000.00", "budgeted net income");
await p.getByRole("button", { name: "Save budget" }).click();
await p.getByText("Budget saved.").waitFor();
await p.screenshot({ path: `${out}/budget.png` });
await p.getByRole("link", { name: "Budget vs actuals" }).click();
await p.waitForURL(/budget-vs-actuals/);
await p.getByRole("rowheader", { name: "Services" }).waitFor();
console.log("· budget vs actuals report shows the budget");
await p.screenshot({ path: `${out}/budget-vs-actuals.png`, fullPage: true });

// ---- receipts: one becomes a new expense, another matches an expense already entered
await p.goto(`${c}/receipts`, { waitUntil: "networkidle" });
await p.getByLabel("Upload receipts").setInputFiles(receiptPng);
const card = p.getByRole("group", { name: /Receipt fixtures-receipt.png/ });
await card.waitFor();
await card.getByLabel("Vendor").fill("Casco Hardware");
await card.getByLabel("Date").fill(today);
await card.getByLabel("Amount").fill("42.17");
await card.getByLabel("Amount").blur();
await p.waitForLoadState("networkidle");
await card.getByRole("button", { name: "Create expense" }).click();
await card.getByLabel("Category").selectOption({ label: "Office Supplies & Software" });
await card.getByRole("button", { name: "Save expense" }).click();
await p.getByRole("heading", { name: "Reviewed" }).waitFor();
await p.getByRole("link", { name: /Expense · Casco Hardware/ }).waitFor();
console.log("· receipt recorded as an expense, with the file attached");

// a second receipt for an expense entered by hand: it's suggested as a match
await p.goto(`${c}/expenses/new`, { waitUntil: "networkidle" });
await p.getByRole("combobox", { name: /^Payee/ }).fill("Portland Cafe");
await p.getByRole("option", { name: /Add new vendor/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByRole("combobox", { name: "Line 1 category" }).fill("Meals");
await p.getByRole("option", { name: /^Meals/ }).click();
await p.getByLabel("Line 1 amount").fill("18.50");
await p.getByLabel("Line 1 amount").blur();
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/expenses\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
await p.goto(`${c}/receipts`, { waitUntil: "networkidle" });
await p.getByLabel("Upload receipts").setInputFiles(receiptPng);
await card.waitFor();
await card.getByLabel("Date").fill(today);
await card.getByLabel("Date").blur();
await card.getByLabel("Amount").fill("18.50");
await card.getByLabel("Amount").blur();
await card.getByText(/Portland Cafe/).waitFor();
await p.screenshot({ path: `${out}/receipts.png`, fullPage: true });
await card.getByRole("button", { name: "Attach" }).click();
await p.getByRole("link", { name: /Expense · Portland Cafe/ }).waitFor();
console.log("· receipt matched to an existing expense");

// ---- invite someone as reports-only
await p.goto(`${c}/users`, { waitUntil: "networkidle" });
const email = `viewer+${Date.now()}@example.com`;
await p.getByRole("button", { name: "Invite a user" }).click();
await d.getByLabel(/^Email/).fill(email);
await d.getByLabel(/^Reports only/).check();
await d.getByRole("button", { name: "Send invitation" }).click();
const link = await d.getByLabel("Invitation link").inputValue();
await d.getByRole("button", { name: "Done" }).click();
await p.getByRole("row", { name: new RegExp(email.replace(/[+.]/g, "\\$&")) }).getByText("Invited").waitFor();
console.log("· invitation created");
await p.screenshot({ path: `${out}/users.png` });

// the invitee, in a fresh browser session
const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const q = await ctx2.newPage();
q.on("pageerror", (e) => errors.push(e.message));
await q.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
await q.getByRole("heading", { name: /^Join Harbor Studio LLC/ }).waitFor();
await q.getByRole("link", { name: "Create an account" }).click();
expectEq(await q.getByLabel("Email").inputValue(), email, "invite email filled in");
await q.getByLabel("Your name").fill("Val Viewer");
await q.getByLabel("Password").fill("correct horse battery");
await q.getByRole("button", { name: "Create account" }).click();
await q.getByRole("button", { name: "Accept invitation" }).click();
await q.waitForURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 60000 });
await q.getByText(/You have view-only access/).waitFor();
expectEq(await q.getByRole("button", { name: "New" }).count(), 0, "no New button for reports-only");
expectEq(await q.getByRole("link", { name: "Settings" }).count(), 0, "no Settings for reports-only");
console.log("· invitee joined with view-only access");
await q.goto(`${c.replace(/^https?:\/\/[^/]+/, BASE)}/settings`);
expectEq(await q.getByRole("heading", { name: "Settings" }).count(), 0, "settings page refused");
await ctx2.close();

// back as the owner: the invitee is active
await p.reload({ waitUntil: "networkidle" });
await p.getByRole("row", { name: /Val Viewer/ }).getByText("Active").waitFor();
console.log("· owner sees the new user as active");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
