import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);
const d = p.getByRole("dialog");

async function sale(path, amount) {
  await p.goto(`${c}/${path}/new`);
  await p.getByRole("combobox", { name: /^Customer/ }).fill("Acme");
  const o = p.getByRole("option", { name: /^Acme$/ });
  if (await o.count()) await o.click();
  else {
    await p.getByRole("option", { name: /Add new customer/ }).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await d.waitFor({ state: "detached" });
  }
  await p.getByRole("combobox", { name: "Line 1 product or service" }).fill("Work");
  const it = p.getByRole("option", { name: /^Work$/ });
  if (await it.count()) await it.click();
  else {
    await p.getByRole("option", { name: /Add new/ }).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await d.waitFor({ state: "detached" });
  }
  await p.getByLabel("Line 1 amount").fill(amount);
  await p.getByLabel("Line 1 amount").blur();
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForURL(/\?saved=1/, { timeout: 60000 });
}
await sale("credit-memos", "100");
await sale("invoices", "300");
await p.getByRole("region", { name: "Credits available" }).waitFor();
await p.getByRole("button", { name: "Apply $100.00" }).click();
await p.getByText("Partially paid").waitFor();
const due = await p.locator("text=Balance due").first().locator("xpath=following-sibling::p").textContent();
expectEq(due, "$200.00", "balance due after applying the credit memo");
await p.screenshot({ path: `${out}/invoice-credit-applied.png`, fullPage: true });
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
