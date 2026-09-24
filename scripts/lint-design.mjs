#!/usr/bin/env node
/**
 * DESIGN.md enforcement for web/.
 *
 * Fails on:
 *   - text-[9px] / text-[10px] (too small for body/chrome)
 *   - box-shadow / drop-shadow utilities or CSS
 *   - rounded-(sm|md|lg|xl|2xl|3xl) outside allowlisted dock chrome
 *   - Tailwind arbitrary hex colours (bg-[#…], text-[#…], …)
 *   - "Return to the index" footer copy (use ← Home)
 *   - Escrow as a GlobalDock NAV item
 *
 * Allowlisted for intentional exceptions: GlobalDock, DynamicIsland (pill),
 * and tiny status dots (rounded-full on h-1.5/w-1.5 only — not scanned as
 * rounded-sm/md/lg).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../web", import.meta.url).pathname;
const ALLOW_ROUNDED = new Set([
  "components/GlobalDock.tsx",
  "components/catalog/DynamicIsland.tsx",
]);

const BANNED = [
  {
    id: "tiny-type",
    re: /text-\[(?:9|10)px\]/,
    msg: "text-[9px]/text-[10px] banned — use text-[11px]+ or text-xs",
  },
  {
    id: "box-shadow",
    re: /\b(?:box-shadow|drop-shadow)(?:-|\b)|shadow-(?:sm|md|lg|xl|2xl|inner)\b/,
    msg: "box-shadow / drop-shadow / shadow-* banned on UI surfaces",
  },
  {
    id: "rounded-surface",
    re: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/,
    msg: "rounded-sm/md/lg/xl banned outside GlobalDock / DynamicIsland",
  },
  {
    id: "arbitrary-hex",
    re: /(?:bg|text|border|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/,
    msg: "Tailwind arbitrary hex colours banned — use tokens from globals.css",
  },
  {
    id: "return-to-index",
    re: /Return to the index/,
    msg: 'Use "← Home" instead of "Return to the index"',
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let failures = 0;

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  for (const rule of BANNED) {
    if (rule.id === "rounded-surface" && ALLOW_ROUNDED.has(rel)) continue;
    lines.forEach((line, i) => {
      if (rule.re.test(line)) {
        console.error(`${rel}:${i + 1}: ${rule.msg}`);
        console.error(`  ${line.trim()}`);
        failures++;
      }
    });
  }

  // Dock inventory: Escrow must not reappear as a persistent NAV item.
  if (rel === "components/GlobalDock.tsx") {
    const navBlock = src.match(/const NAV\s*=\s*\[[\s\S]*?\];/);
    if (navBlock && /Escrow/i.test(navBlock[0])) {
      console.error(
        `${rel}: Escrow must not be a GlobalDock NAV item (⌘K only)`,
      );
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\nlint-design: ${failures} violation(s)`);
  process.exit(1);
}
console.log(`lint-design: ok (${files.length} files)`);
