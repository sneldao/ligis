/**
 * Trust receipt rendering — the human-readable `ligis trust check` output.
 *
 * Matches the repo's terminal style: no emojis, ✓/✗ verdicts, ANSI colour
 * only when stdout is a TTY so piped output stays plain. `--json` callers get
 * the raw TrustReceipt object instead; this module never prints.
 */
import type { TrustReceipt, TrustSignal } from "@ligis/core";

const tty = process.stdout.isTTY === true;
const c = {
  bold: tty ? "\x1b[1m" : "",
  dim: tty ? "\x1b[2m" : "",
  green: tty ? "\x1b[32m" : "",
  red: tty ? "\x1b[31m" : "",
  reset: tty ? "\x1b[0m" : "",
};

function formatUsd(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function signalLabel(signal: TrustSignal): string {
  const target =
    signal.kind === "capability" &&
    typeof signal.metadata?.capability === "string"
      ? (signal.metadata.capability as string)
      : signal.source;
  return `${signal.kind}:${target}`;
}

function verdictToken(
  verdict: TrustSignal["verdict"] | TrustReceipt["verdict"],
  pad = true,
): string {
  const plain =
    verdict === "go" ? "✓ GO" : verdict === "stop" ? "✗ STOP" : "? UNKNOWN";
  const color = verdict === "go" ? c.green : verdict === "stop" ? c.red : c.dim;
  const token = `${color}${plain}${c.reset}`;
  return pad ? `${token}${" ".repeat(10 - plain.length)}` : token;
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(18)}${value}`;
}

/** Render the receipt as the human-readable table printed by `ligis trust check`. */
export function renderTrustReceipt(receipt: TrustReceipt): string {
  const lines: string[] = [];

  lines.push(`${c.bold}ligis trust check — receipt${c.reset}`);
  lines.push("");
  lines.push(row("counterparty", receipt.counterparty));
  lines.push(row("intent", receipt.intent));
  if (receipt.amount !== undefined) lines.push(row("amount", receipt.amount));
  lines.push(row("expires", new Date(receipt.expiresAt * 1000).toISOString()));

  const kindWidth = Math.max(...receipt.signals.map((s) => s.kind.length), 10);
  const sourceWidth = Math.max(
    ...receipt.signals.map((s) => s.source.length),
    "source".length,
  );
  lines.push("");
  lines.push(`${c.bold}signals${c.reset}`);
  for (const s of receipt.signals) {
    const cost =
      s.cost !== undefined
        ? `   ${
            s.cost.currency.toUpperCase() === "USD"
              ? `${formatUsd(s.cost.amount)}/check`
              : `${s.cost.amount} ${s.cost.currency}/check`
          }`
        : "";
    lines.push(
      `  ${s.kind.padEnd(kindWidth)}  ${s.source.padEnd(sourceWidth)}  ${verdictToken(s.verdict)}  confidence ${s.confidence}${cost}`,
    );
  }
  if (receipt.signals.length === 0) {
    lines.push(`  ${c.dim}(no signals recorded)${c.reset}`);
  }

  const stopped = receipt.signals.filter((s) => s.verdict === "stop");
  const reason =
    stopped.length > 0
      ? stopped.map(signalLabel).join("; ")
      : "all signals passed";
  lines.push("");
  lines.push(`${c.bold}verdict${c.reset}`);
  lines.push(`  ${verdictToken(receipt.verdict, false)} — ${reason}`);

  const { incumbent, provider, savingsPct } = receipt.cost;
  lines.push("");
  lines.push(`${c.bold}cost per check${c.reset}`);
  lines.push(
    row(
      incumbent.name,
      `${formatUsd(incumbent.perCheckUsd)}/check   + $${incumbent.monthlyUsd}/mo minimum`,
    ),
  );
  lines.push(
    row(
      provider.name,
      provider.perCheckUsd !== undefined
        ? `${formatUsd(provider.perCheckUsd)}/check`
        : "measured on dashboard",
    ),
  );
  if (savingsPct !== undefined) {
    lines.push(row("savings", `${savingsPct}% per check vs ${incumbent.name}`));
  }

  lines.push("");
  lines.push(`${c.bold}receipt${c.reset}`);
  lines.push(row("manifest hash", receipt.manifestHash));
  if (receipt.storage) {
    lines.push(row("0G root hash", receipt.storage.rootHash));
  }
  if (receipt.anchoredTokenUri) {
    lines.push(row("anchored uri", receipt.anchoredTokenUri));
  }

  return lines.join("\n");
}
