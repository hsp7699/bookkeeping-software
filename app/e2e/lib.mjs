// Shared helpers for the e2e smoke scripts.
import { chromium } from "@playwright/test";

export const BASE = process.env.BASE_URL ?? "http://localhost:3100";

export async function start() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { browser, page, errors };
}

/** Sign up a fresh user and create a company. Returns the company base URL. */
export async function newCompany(page, name = "Harbor Studio LLC") {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Your name").fill("Pat Owner");
  await page.getByLabel("Email").fill(`e2e+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/setup", { timeout: 60000 });
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 60000 });
  return page.url();
}

export function expectEq(actual, expected, what) {
  if (String(actual).trim() !== String(expected)) throw new Error(`${what}: expected ${expected}, got ${actual}`);
  console.log(`· ${what}: ${expected}`);
}
