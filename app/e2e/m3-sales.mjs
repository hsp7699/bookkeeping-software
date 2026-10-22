import { BASE, expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);

// a customer and a service, via the lists
await p.goto(`${c}/customers`);
await p.getByRole("button", { name: "New customer" }).click();
await p.getByRole("dialog").getByRole("textbox", { name: /^Customer display name/ }).fill("Harbor Coffee");
await p.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });
await p.goto(`${c}/items`);
await p.getByRole("button", { name: "New product or service" }).click();
await p.getByRole("dialog").getByRole("textbox", { name: /^Name/ }).fill("Design hours");
await p.getByRole("dialog").getByLabel("Price / rate").fill("120");
await p.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });

async function fillSale(path, qty) {
  await p.goto(`${c}/${path}/new`);
  await p.getByRole("combobox", { name: /^Customer/ }).click();
  await p.getByRole("option", { name: /Harbor Coffee/ }).click();
  await p.getByRole("combobox", { name: "Line 1 product or service" }).click();
  await p.getByRole("option", { name: /Design hours/ }).click();
  await p.getByLabel("Line 1 quantity").fill(String(qty));
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForURL(/\/[0-9a-f-]{36}\?saved=1/, { timeout: 60000 });
}

await fillSale("sales-receipts", 2);
console.log("· sales receipt saved");
await fillSale("credit-memos", 1);
console.log("· credit memo saved");
await fillSale("refunds", 1);
console.log("· refund saved");
await fillSale("invoices", 10);
const invoiceUrl = p.url().split("?")[0];
console.log("· invoice saved");

// PDF renders
const pdf = await p.request.get(`${invoiceUrl}/pdf`);
expectEq(pdf.headers()["content-type"], "application/pdf", "invoice PDF content type");
const bytes = (await pdf.body()).subarray(0, 5).toString();
expectEq(bytes, "%PDF-", "invoice PDF magic bytes");

// email without SMTP explains itself
await p.getByRole("button", { name: /^More/ }).click();
await p.getByRole("menuitem", { name: "Email invoice" }).click();
await p.getByRole("dialog").getByLabel("To").fill("ap@harbor.example");
await p.getByRole("dialog").getByRole("button", { name: "Send" }).click();
await p.getByText("Email isn't set up yet").waitFor();
console.log("· email without SMTP gives a clear message");
await p.keyboard.press("Escape");

// void it
await p.getByRole("button", { name: /^More/ }).click();
await p.getByRole("menuitem", { name: "Void" }).click();
await p.getByRole("alertdialog").getByRole("button", { name: "Void" }).click();
await p.getByText(/is voided/).waitFor();
console.log("· invoice voided");

await p.goto(`${c}/sales`);
await p.screenshot({ path: `${out}/sales-list.png` });
const rows = await p.locator("tbody tr").count();
expectEq(rows, 4, "sales list rows");

// P&L: receipt 240 − credit memo 120 − refund 120 = 0 (the voided invoice counts nothing)
await p.goto(`${c}/reports/profit-and-loss`);
await p.getByText("Net income").waitFor().catch(() => {});
const empty = await p.getByText("No income or expenses in this period.").count();
const net = empty ? "$0.00" : await p.locator("tr", { hasText: "Net income" }).locator("td").textContent();
expectEq(net, "$0.00", "net income after receipt, credit memo, refund and void");

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
