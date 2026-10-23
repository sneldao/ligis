#!/usr/bin/env node
/**
 * Security floor for the monorepo lockfile — CI enforcement for advisories.
 *
 * Dependabot PROPOSES bumps; it does not block. A critical fix (e.g. next
 * 16.4.1, follow-redirects 1.16.1) can sit in an open PR for days while the
 * vulnerable version stays on main. This closes that gap: it runs `pnpm
 * audit --json` against the checked-out lockfile and fails when any
 * REMAINING advisory is high or critical — "remaining" meaning not on the
 * documented dismissal list.
 *
 * The dismissal list MUST stay in sync with the `ignore` block in
 * .github/dependabot.yml — both files record the same policy decision
 * (unfixable transitive, no reachable patch). If you add an ignore there,
 * add it here, or this gate will fail on it.
 *
 * Floors go in pnpm.overrides (root package.json) when the vulnerable
 * version is a transitive the project cannot bump directly; direct deps
 * get a normal version bump.
 *
 * Usage:
 *   node scripts/security-audit.mjs            # audit the lockfile, fail on remaining high/critical
 *   node scripts/security-audit.mjs --self-test # verify the parser + verdict logic offline
 */
import { spawnSync } from "node:child_process";

/**
 * Documented policy dismissals — mirror of .github/dependabot.yml `ignore`.
 * Both are client-side transitives of wallet-connector SDKs with no
 * reachable fix in our dependency surface; see the comments there.
 */
const DISMISSED = new Set([
  "GHSA-w5hq-g745-h8pq", // uuid — pinned ^8 by @metamask/sdk; advisory needs v3/v5/v6 + explicit buffer
  "GHSA-vcc3-ghjq-m6fr", // decode-uri-component — pinned ^0.2.0 by query-string@7; client-side only
]);

const FAIL_SEVERITIES = new Set(["high", "critical"]);

/** Extract the actionable set from a `pnpm audit --json` document. */
export function auditFindings(auditJson) {
  const advisories = auditJson?.advisories ?? {};
  const findings = [];
  for (const [id, adv] of Object.entries(advisories)) {
    const ghsa = adv.github_advisory_id ?? null;
    if (ghsa && DISMISSED.has(ghsa)) continue;
    findings.push({
      id,
      ghsa,
      module: adv.module_name ?? "unknown",
      severity: adv.severity ?? "unknown",
      vulnerable: adv.vulnerable_versions ?? "",
      patched: adv.patched_versions ?? "no published fix",
      installed: [...new Set((adv.findings ?? []).map((f) => f.version))].sort(),
      title: (adv.title ?? "").trim(),
    });
  }
  return findings;
}

/** The verdict: only REMAINING high/critical block the build. */
export function blockingFindings(findings) {
  return findings.filter((f) => FAIL_SEVERITIES.has(f.severity));
}

function renderReport(findings, blockers, dismissedCount = 0) {
  const lines = [];
  const dismissedNote =
    dismissedCount > 0 ? ` (${dismissedCount} documented dismissal(s) excluded)` : "";
  if (findings.length === 0) {
    lines.push(`security-audit: ok — no advisories remain in the lockfile${dismissedNote}`);
    return lines.join("\n");
  }
  for (const f of findings) {
    const mark = FAIL_SEVERITIES.has(f.severity) ? "BLOCKING" : "noted  ";
    lines.push(
      `${mark} [${f.severity}] ${f.module} @ ${f.installed.join(", ")} — ${f.ghsa ?? f.id}`,
    );
    lines.push(`         ${f.title}`);
    lines.push(
      `         vulnerable ${f.vulnerable} -> fixed in ${f.patched}`,
    );
  }
  if (blockers.length > 0) {
    lines.push("");
    lines.push(
      `${blockers.length} advisory(ies) above the floor. Bump the direct dep, or add a pnpm.overrides floor (root package.json) for transitives.`,
    );
  } else {
    lines.push("");
    lines.push(
      `security-audit: ok — no remaining high/critical advisories ` +
        `(${DISMISSED.size} documented dismissal(s) excluded)`,
    );
  }
  return lines.join("\n");
}

function selfTest() {
  let failures = 0;
  const check = (name, cond) => {
    if (cond) {
      console.log(`  ok    ${name}`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${name}`);
    }
  };

  const fixture = {
    advisories: {
      "1": {
        github_advisory_id: "GHSA-fake-high-0001",
        module_name: "follow-redirects",
        severity: "high",
        vulnerable_versions: ">= 1.16.0, < 1.16.1",
        patched_versions: "1.16.1",
        title: "test high",
        findings: [{ version: "1.16.0" }],
      },
      "2": {
        github_advisory_id: "GHSA-fake-crit-0002",
        module_name: "next",
        severity: "critical",
        vulnerable_versions: "<= 16.4.0",
        patched_versions: "16.4.1",
        title: "test critical",
        findings: [{ version: "16.4.0" }, { version: "16.4.0" }],
      },
      "3": {
        github_advisory_id: "GHSA-w5hq-g745-h8pq",
        module_name: "uuid",
        severity: "moderate",
        vulnerable_versions: "x",
        patched_versions: "y",
        title: "documented dismissal",
        findings: [{ version: "8.3.2" }],
      },
      "4": {
        github_advisory_id: "GHSA-fake-med-0003",
        module_name: "some-dep",
        severity: "moderate",
        vulnerable_versions: "<1",
        patched_versions: "1.0",
        title: "below floor",
        findings: [{ version: "0.9" }],
      },
      "5": {
        module_name: "no-ghsa",
        severity: "high",
        vulnerable_versions: "<1",
        patched_versions: "1.0",
        title: "high without ghsa id",
        findings: [{ version: "0.1" }],
      },
    },
  };

  const findings = auditFindings(fixture);
  check("dismissed GHSAs are excluded", findings.length === 4);
  check(
    "duplicate installed versions are deduped",
    findings.find((f) => f.module === "next")?.installed.length === 1,
  );
  check(
    "missing ghsa id does not drop the advisory",
    findings.some((f) => f.module === "no-ghsa"),
  );

  const blockers = blockingFindings(findings);
  check(
    "blocking set is exactly the remaining high+critical",
    blockers.length === 3 &&
      blockers.every((f) => FAIL_SEVERITIES.has(f.severity)) &&
      blockers.some((f) => f.module === "no-ghsa"),
  );
  check(
    "empty document is clean",
    blockingFindings(auditFindings({})).length === 0 &&
      auditFindings(null).length === 0,
  );
  check(
    "report names the floor rule when blocking",
    renderReport(findings, blockers).includes("pnpm.overrides"),
  );
  check(
    "report is ok when nothing blocks",
    renderReport([], [], 2).includes("security-audit: ok") &&
      renderReport([], [], 2).includes("2 documented dismissal(s) excluded"),
  );

  if (failures > 0) {
    console.error(`\nself-test: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nself-test: all checks passed");
}

function main() {
  const result = spawnSync("pnpm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`security-audit: could not run pnpm audit — ${result.error.message}`);
    process.exit(1);
  }
  let auditJson;
  try {
    auditJson = JSON.parse(result.stdout);
  } catch (err) {
    console.error(
      `security-audit: could not parse pnpm audit output — ${err.message}\n${(result.stdout ?? "").slice(0, 500)}`,
    );
    process.exit(1);
  }
  const all = Object.keys(auditJson?.advisories ?? {}).length;
  const findings = auditFindings(auditJson);
  const blockers = blockingFindings(findings);
  const dismissed = all - findings.length;
  console.log(renderReport(findings, blockers, dismissed));
  process.exit(blockers.length > 0 ? 1 : 0);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main();
}
