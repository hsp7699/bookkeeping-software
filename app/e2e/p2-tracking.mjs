import { expectEq, newCompany, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
const c = await newCompany(p);
const d = p.getByRole("dialog");
await p.goto(`${c}/settings`, { waitUntil: "networkidle" });
for (const [kind, name] of [["class", "Design"], ["class", "Print"], ["location", "Portland"], ["tag", "Spring promo"]]) {
  await p.getByLabel(`New ${kind} name`).fill(name);
  await p.getByRole("button", { name: `Add ${kind}` }).click();
  await p.getByRole("button", { name: `Remove ${name}` }).waitFor();
}
console.log("· classes, location and tag added");

await p.goto(`${c}/invoices/new`, { waitUntil: "networkidle" });
await p.getByRole("combobox", { name: /^Customer/ }).fill("Acme");
await p.getByRole("option", { name: /Add new customer/ }).click();
await d.getByRole("button", { name: "Save", exact: true }).click();
await d.waitFor({ state: "detached" });
await p.getByLabel("Location").selectOption({ label: "Portland" });
await p.getByRole("button", { name: "Spring promo" }).click();
for (const [n, cls, amt] of [[1, "Design", "700"], [2, "Print", "300"]]) {
  await p.getByRole("combobox", { name: `Line ${n} product or service` }).fill("Work");
  const o = p.getByRole("option", { name: /^Work$/ });
  if (await o.count()) await o.click();
  else {
    await p.getByRole("option", { name: /Add new/ }).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await d.waitFor({ state: "detached" });
  }
  await p.getByLabel(`Line ${n} amount`).fill(amt);
  await p.getByLabel(`Line ${n} amount`).blur();
  await p.getByLabel(`Line ${n} class`).selectOption({ label: cls });
}
await p.screenshot({ path: `${out}/invoice-tracking.png`, fullPage: true });
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForURL(/\?saved=1/, { timeout: 60000 });
expectEq(await p.getByLabel("Line 2 class").inputValue().then((v) => !!v), true, "class kept after save");
expectEq(await p.getByRole("button", { name: "Spring promo" }).getAttribute("aria-pressed"), "true", "tag kept after save");

await p.goto(`${c}/reports/profit-and-loss?columns=class`);
const row = p.locator("tr", { hasText: "Services" });
expectEq(await row.locator("td").nth(0).textContent(), "$700.00", "Design column");
expectEq(await row.locator("td").nth(1).textContent(), "$300.00", "Print column");
await p.screenshot({ path: `${out}/pnl-by-class.png`, fullPage: true });
await p.goto(`${c}/reports/profit-and-loss?columns=location`);
expectEq(await p.locator("tr", { hasText: "Services" }).locator("td").nth(0).textContent(), "$1,000.00", "Portland column");
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
