// Run after `npm run seed:demo`. Screenshots the dashboard and every report.
import { BASE, start } from "./lib.mjs";

const out = process.argv[2] ?? ".";
const { browser, page: p, errors } = await start();
await p.goto(`${BASE}/login`);
await p.getByLabel("Email").fill("demo@example.com");
await p.getByLabel("Password").fill("demo-books-2026");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 180000 });
const c = p.url();
await p.screenshot({ path: `${out}/dashboard.png`, fullPage: true });
// hover a bar
const bars = p.locator("svg[role=img] rect[fill=transparent]");
await bars.nth(4).hover();
await p.getByRole("status").first().waitFor();
await p.screenshot({ path: `${out}/dashboard-hover.png` });
console.log("· dashboard + chart tooltip");

for (const [slug, file] of [
  ["profit-and-loss?range=fy_to_date", "rep-pnl"],
  ["profit-and-loss?range=fy_to_date&columns=months&basis=cash", "rep-pnl-months-cash"],
  ["balance-sheet", "rep-bs"],
  ["balance-sheet?basis=cash", "rep-bs-cash"],
  ["ar-aging", "rep-ar"],
  ["ap-aging?view=detail", "rep-ap-detail"],
  ["general-ledger?range=last_month", "rep-gl"],
]) {
  await p.goto(`${c}/reports/${slug}`);
  await p.locator("main").waitFor();
  if (await p.getByText(/This balance sheet is off by/).count()) throw new Error(`${slug} out of balance`);
  await p.screenshot({ path: `${out}/${file}.png`, fullPage: true });
  console.log(`· ${slug}`);
}
// drill into an amount
await p.goto(`${c}/reports/profit-and-loss?range=fy_to_date`);
await p.locator("tr", { hasText: "Rent & Lease" }).getByRole("link").click();
await p.getByRole("heading", { name: "Rent & Lease transactions" }).waitFor();
console.log("· drill-down from P&L works");
// CSV
const csv = await p.request.get(`${c}/reports/balance-sheet/csv`);
const body = await csv.text();
if (!body.includes("Total liabilities and equity")) throw new Error("CSV missing totals");
console.log("· CSV export works");
// search
await p.keyboard.press("/");
await p.keyboard.type("Northside");
await p.keyboard.press("Enter");
await p.getByText(/Results for/).waitFor();
console.log(`· search found ${await p.locator("tbody tr").count()} rows`);
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "OK, no page errors");
await browser.close();
