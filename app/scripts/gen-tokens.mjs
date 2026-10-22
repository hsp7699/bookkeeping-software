// Generates src/app/tokens.css from replica/design/tokens.json (Tailwind v4 @theme).
// Run after any token change: node scripts/gen-tokens.mjs
import { readFileSync, writeFileSync } from "node:fs";

const t = JSON.parse(readFileSync(new URL("../../replica/design/tokens.json", import.meta.url)));
const out = ["/* Generated from replica/design/tokens.json. Do not edit by hand. */", "@theme {"];
for (const [k, v] of Object.entries(t.color)) out.push(`  --color-${k}: ${v};`);
out.push(`  --font-sans: ${t.font.sans};`, `  --font-mono: ${t.font.mono};`);
for (const [k, v] of Object.entries(t.type)) {
  out.push(`  --text-${k}: ${v.size / 16}rem;`, `  --text-${k}--line-height: ${v.line / 16}rem;`);
}
for (const [k, v] of Object.entries(t.radius)) out.push(`  --radius-${k}: ${v}px;`);
for (const [k, v] of Object.entries(t.shadow)) out.push(`  --shadow-${k}: ${v};`);
out.push(`  --ease-ui: ${t.motion.ease};`);
out.push("}", "", ":root {");
for (const [k, v] of Object.entries(t.layout)) if (typeof v === "number") out.push(`  --${k}: ${v}px;`);
out.push(`  --motion-fast: ${t.motion.fast};`, `  --motion-base: ${t.motion.base};`, "}");
writeFileSync(new URL("../src/app/tokens.css", import.meta.url), out.join("\n") + "\n");
console.log("wrote src/app/tokens.css");
