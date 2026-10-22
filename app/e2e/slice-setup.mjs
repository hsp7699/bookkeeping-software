// Smoke run: sign up -> set up a company -> land on Home. Saves a screenshot.
// Usage: node e2e/slice-setup.mjs <screenshot dir>
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? ".";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const email = `owner+${Date.now()}@example.com`;
await p.goto("http://localhost:3100/signup");
await p.getByLabel("Your name").fill("Pat Owner");
await p.getByLabel("Email").fill(email);
await p.getByLabel("Password").fill("correct horse battery");
await p.getByRole("button", { name: "Create account" }).click();
await p.waitForURL("**/setup", { timeout: 60000 });
await p.getByLabel("Business name").fill("Harbor Studio LLC");
await p.getByRole("button", { name: "Create company" }).click();
await p.waitForURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 60000 });
await p.screenshot({ path: `${out}/home.png` });
console.log("OK", email, p.url(), "page errors:", errors);
await b.close();
