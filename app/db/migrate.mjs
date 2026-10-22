// Applies db/migrations/*.sql in order, once each, inside a transaction.
// Usage: DATABASE_URL=... node db/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const dir = new URL("./migrations/", import.meta.url);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) continue;
  process.stdout.write(`applying ${file} ... `);
  try {
    await client.query("begin");
    await client.query(readFileSync(new URL(file, dir), "utf8"));
    await client.query("insert into schema_migrations (name) values ($1)", [file]);
    await client.query("commit");
    console.log("ok");
  } catch (e) {
    await client.query("rollback");
    console.log("FAILED");
    console.error(e.message);
    process.exit(1);
  }
}
await client.end();
