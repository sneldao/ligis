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
 *   - User-facing "capable / not capable" verdict vocabulary
 *   - App routes missing route-shell (except landing / field / redirects)
 *   - App routes with route-shell missing "Ligis ·" room eyebrow
 *   - Hand-rolled `live-dot` class outside LiveDot.tsx / globals.css
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

/** Pages that are not app-shell routes (landing, field, redirects). */
const NO_ROUTE_SHELL = new Set([
  "app/page.tsx",
  "app/field/page.tsx",
  "app/arena/page.tsx",
  "app/verify/page.tsx",
  "app/verify-casper/page.tsx",
  "app/embed/verify/page.tsx",
]);

/** Files allowed to reference the live-dot CSS class directly. */
const ALLOW_LIVE_DOT_CLASS = new Set([
  "components/LiveDot.tsx",
  "app/globals.css",
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
    id: "rounded-full-cta",
    re: /\brounded-full\b/,
    msg: 'rounded-full is for the dock, status dots, and verdict-status badges only. Use square surfaces or a terra-underlined action instead (see docs/positioning.md and Phase 2 verdict shape rule).',
    // Per-line exemptions, applied below.
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
  {
    id: "verdict-vocab",
    re: /\bnot capable\b|capable\s*\/\s*not|Capable\s*\/\s*Not/,
    msg: 'User-facing verdict is ✓ GO / ✗ STOP via GateVerdict — not "capable / not capable"',
  },
  {
    id: "unmeasured-latency",
    re: /\bunder\s+\d+\s*m?s\b/i,
    msg: 'Unmeasured latency claim. Use a measured value (see docs/positioning.md "Claims, with sources") or drop the claim.',
  },
  {
    id: "verifiable-credentials",
    re: /verifiable credentials/i,
    msg: '"verifiable credentials" is internal vocabulary. Use the user words from docs/positioning.md: "verified payee", "permission", "verifier".',
  },
  {
    id: "isCapable-metadata",
    re: /description:\s*["'][^"'\n]*\bisCapable\b[^"'\n]*["']/,
    msg: 'Metadata descriptions describe the decision (GO/STOP), not the SDK call name. See docs/positioning.md.',
  },
  {
    id: "verdict-color-tokens",
    // Verdict-semantic tokens (text-go/text-stop night, text-sage/text-revoke
    // paper) belong on verdict primitives and incident-mode surfaces only.
    re: /\b(?:text|bg|border|fill|stroke)-(?:go|stop|sage|revoke)\b/,
    msg: 'Verdict-color tokens (text-go/stop/sage/revoke) belong on verdict primitives (GateVerdict, ArenaVerdict, SituationCast, JevTelemetry, TrustReceipt, SignalStack, GateStates, FocusPanel, /arena) and status dots. Other UI uses text-ink / text-ink-soft / text-ink-quiet / text-terra / text-sky.',
    // Per-file and per-pattern exemptions, applied below.
  },
];

// Rules that should only trigger on UI surfaces (app/ + components/).
const UI_RULE_IDS = new Set([
  "verdict-vocab",
  "unmeasured-latency",
  "verifiable-credentials",
  "isCapable-metadata",
  "rounded-full-cta",
  "verdict-color-tokens",
]);

// Files where `kyc.basic` may NOT appear. Capability ids belong in
// technical surfaces (compose, capabilities, embed, agent pages) — not
// in the landing/hero where the visitor hasn't read positioning.md yet.
const HERO_LANDING_PATHS = [
  /^app\/layout\.tsx$/,
  /^app\/page\.tsx$/,
  /^components\/landing\//,
];
const HERO_LANDING_RULE = {
  id: "kyc-basic-hero",
  re: /\bkyc\.basic\b/,
  msg: '"kyc.basic" in hero/landing copy is a banned credential id. Use "verified payee" (glossary in docs/positioning.md) or move to a technical surface.',
};

// /gate user-language rule — see docs/user-test.md.
//
// The form field labels on /gate must use user-language from
// docs/positioning.md: "payee · wallet", "permission", "registry".
// Internal words ("subject", "capability", "chain") may still appear in
// the developer disclosure, in code, in comments, and in URL query
// params, but NOT as the visible label or placeholder text on the
// gate form, the busy state, or any verdict surface on /gate.
//
// Scope: the gate form component, the /gate page, the verdict primitives
// rendered on /gate, and the Jev telemetry waterfall. The
// developer-disclosure aria-label and the developer disclosure copy
// itself are exempt — they are technical surfaces.
const GATE_USER_LANG_PATHS = [
  /^app\/gate\/page\.tsx$/,
  /^components\/GateFormShell\.tsx$/,
  /^components\/GateVerdict\.tsx$/,
  /^components\/JevTelemetry\.tsx$/,
];
const GATE_USER_LANG_RULES = [
  {
    id: "gate-label-subject",
    re: />\s*subject\s*</,
    msg: '/gate user-facing label "subject" is banned — use "payee · wallet" (glossary in docs/positioning.md).',
  },
  {
    id: "gate-label-capability",
    re: />\s*capability\s*</,
    msg: '/gate user-facing label "capability" is banned — use "permission" (glossary in docs/positioning.md).',
  },
  {
    id: "gate-busy-state-chain",
    re: /Reading chain\b/,
    msg: '/gate busy-state "Reading chain" is internal — use "Reading registry" or "Reading on-chain approvals" (see /gate wording).',
  },
];

// Files allowed to use `rounded-full` (verdict primitives with status badges).
// Status dots are exempted by pattern below, not by file.
const ROUNDED_FULL_ALLOWLIST = new Set([
  "components/arena/ArenaVerdict.tsx", // "Judging" + GO badges
]);

// Per-line patterns that exempt rounded-full: status dots (h-1.5 w-1.5, h-2
// w-2, size-1.5 etc). These are the canonical "live pulse" + connection
// status indicators used across the codebase.
const ROUNDED_FULL_LINE_EXEMPTIONS = [
  /\bsize-1\.5\b/,
  /\bsize-2\b/,
  /\bh-1\.5\s+w-1\.5\b/,
  /\bh-2\s+w-2\b/,
];

// Files where verdict-color tokens (text-go/stop/sage/revoke + bg-/border-/
// fill-/stroke- prefixed) may appear. The rule is strict: only primitives
// that explicitly render a verdict, plus the night-mode + status-indicator
// surfaces that have a verdict-adjacent duty.
//
// Path globs cover entire routes / families that are verdict-aware:
//   - app/**        — every route IS a verdict-aware surface
//   - components/arena/**  — the night-mode attack demo
//   - components/landing/** — the night-themed hero (text-go / text-stop)
//   - components/steward/**  — the autonomous loop with verdict-adjacent phase states
// Named files cover primitives + status indicators that aren't otherwise in scope.
const VERDICT_COLOR_ALLOW_PATHS = [
  /^app\//, // every route renders or annotates a verdict
  /^components\/arena\//, // night-mode arena primitives
  /^components\/landing\//, // night-themed hero surfaces
  /^components\/steward\//, // phase indicators (verdict-adjacent)
];
const VERDICT_COLOR_ALLOW_FILES = new Set([
  // Verdict primitives (paper mode)
  "components/GateVerdict.tsx",
  "components/VerdictMark.tsx",
  "components/SituationCast.tsx",
  "components/TrustReceipt.tsx",
  "components/SignalStack.tsx",
  "components/JevTelemetry.tsx",
  "components/GateStates.tsx",
  // Detail panels that display a verdict
  "components/catalog/FocusPanel.tsx",
  // Verdict-aware demos and infrastructure
  "components/VerifyDemo.tsx",
  "components/StewardTeaser.tsx",
  "components/StewardRunner.tsx",
  "components/WalletGate.tsx",
  "components/UnifiedWalletChip.tsx",
  "components/ConnectWalletInner.tsx",
  "components/ChainBadge.tsx",
  // Design system source / styleguide specimen
  "app/globals.css",
  "app/styleguide/page.tsx",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist")
      continue;
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
    // Per-line / per-file exemptions for rounded-full-cta.
    if (rule.id === "rounded-full-cta") {
      lines.forEach((line, i) => {
        if (!rule.re.test(line)) return;
        // Allow the line if a status-dot pattern co-occurs.
        if (ROUNDED_FULL_LINE_EXEMPTIONS.some((p) => p.test(line))) return;
        // Allow the file outright (verdict primitives with status badges).
        if (ROUNDED_FULL_ALLOWLIST.has(rel)) return;
        console.error(`${rel}:${i + 1}: ${rule.msg}`);
        console.error(`  ${line.trim()}`);
        failures++;
      });
      continue;
    }
    // Per-file exemptions for verdict-color-tokens.
    if (rule.id === "verdict-color-tokens") {
      const fileAllowed =
        VERDICT_COLOR_ALLOW_FILES.has(rel) ||
        VERDICT_COLOR_ALLOW_PATHS.some((p) => p.test(rel));
      if (!fileAllowed) {
        lines.forEach((line, i) => {
          if (rule.re.test(line)) {
            console.error(`${rel}:${i + 1}: ${rule.msg}`);
            console.error(`  ${line.trim()}`);
            failures++;
          }
        });
      }
      continue;
    }
    // UI-scoped rules only apply to app/ + components/.
    if (
      UI_RULE_IDS.has(rule.id) &&
      !rel.startsWith("app/") &&
      !rel.startsWith("components/")
    ) {
      continue;
    }
    lines.forEach((line, i) => {
      if (rule.re.test(line)) {
        console.error(`${rel}:${i + 1}: ${rule.msg}`);
        console.error(`  ${line.trim()}`);
        failures++;
      }
    });
  }

  // kyc.basic ban: only on hero / landing paths.
  if (HERO_LANDING_PATHS.some((re) => re.test(rel))) {
    lines.forEach((line, i) => {
      if (HERO_LANDING_RULE.re.test(line)) {
        console.error(`${rel}:${i + 1}: ${HERO_LANDING_RULE.msg}`);
        console.error(`  ${line.trim()}`);
        failures++;
      }
    });
  }

  // /gate user-language rules — see docs/user-test.md.
  // Bans the internal words `subject`, `capability`, and `chain` as visible
  // labels on /gate surfaces (the form, the busy state, the verdict).
  // Developer-disclosure aria-labels and code params are exempt by not
  // matching the regexes below; only text that renders as user copy fails.
  if (GATE_USER_LANG_PATHS.some((re) => re.test(rel))) {
    lines.forEach((line, i) => {
      for (const rule of GATE_USER_LANG_RULES) {
        if (!rule.re.test(line)) continue;
        console.error(`${rel}:${i + 1}: ${rule.msg}`);
        console.error(`  ${line.trim()}`);
        failures++;
      }
    });
  }

  // Dock inventory is locked: only Gate and Field may appear as persistent
  // NAV items. See web/DESIGN.md "Dock inventory" and
  // docs/positioning.md. Arena, GenLayer, CROO, Passkey, Compose,
  // Steward, Capabilities, Issuers, Embed live in ⌘K and the landing
  // hero only — never in the dock.
  if (rel === "components/GlobalDock.tsx") {
    const navBlock = src.match(/const NAV\s*=\s*\[[\s\S]*?\];/);
    if (navBlock) {
      const ALLOWED_DOCK_HREFS = new Set(["/gate", "/field"]);
      const found = navBlock[0].matchAll(/href:\s*["']([^"']+)["']/g);
      const disallowed = [];
      for (const m of found) {
        const href = m[1].replace(/\?.*$/, "");
        if (!ALLOWED_DOCK_HREFS.has(href)) disallowed.push(href);
      }
      if (disallowed.length) {
        console.error(
          `${rel}: dock NAV items are locked to Gate + Field only. Found: ${disallowed.join(", ")}. Move to ⌘K (CommandPalette) and the landing hero.`,
        );
        failures++;
      }
    }
  }

  // App page.tsx files must use route-shell (except landing / field / redirects).
  if (/(^|\/)page\.tsx$/.test(rel) && rel.startsWith("app/")) {
    if (!NO_ROUTE_SHELL.has(rel) && !src.includes("route-shell")) {
      console.error(
        `${rel}: app routes must use route-shell (see DESIGN.md). Landing/field/redirects are exempt.`,
      );
      failures++;
    }
    if (
      src.includes("route-shell") &&
      !/Ligis\s*·/.test(src) &&
      !/Ligis\s*&middot;/.test(src)
    ) {
      console.error(
        `${rel}: route-shell pages need a "Ligis · {Room}" eyebrow`,
      );
      failures++;
    }
  }

  // live-dot CSS class only via <LiveDot /> (or globals definition).
  if (
    !ALLOW_LIVE_DOT_CLASS.has(rel) &&
    /\blive-dot\b/.test(src) &&
    rel.endsWith(".tsx")
  ) {
    lines.forEach((line, i) => {
      if (
        /\blive-dot\b/.test(line) &&
        !/from ["']@\/components\/LiveDot/.test(line)
      ) {
        // Import lines and className="live-dot" — fail className usage.
        if (/className=.*live-dot|["'`]live-dot/.test(line)) {
          console.error(
            `${rel}:${i + 1}: use <LiveDot /> instead of className="live-dot"`,
          );
          console.error(`  ${line.trim()}`);
          failures++;
        }
      }
    });
  }
}

if (failures > 0) {
  console.error(`\nlint-design: ${failures} violation(s)`);
  process.exit(1);
}
console.log(`lint-design: ok (${files.length} files)`);
