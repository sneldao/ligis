/**
 * Capture terminal output for the CROO demo video composition.
 *
 * Runs the on-chain verification path (no CROO SDK key required) and saves
 * stdout to capture/croo-demo-terminal.txt for use in index.html.
 *
 * Usage (from repo root):
 *   source .env.d/casper.env
 *   cd videos/ligis-croo-hackathon && pnpm capture
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const outDir = join(__dirname, "capture");
const outFile = join(outDir, "croo-demo-terminal.txt");

async function main() {
  await mkdir(outDir, { recursive: true });

  const child = spawn(
    "pnpm",
    ["demo:croo", "--", "--on-chain-only", "--capability", "agent.commerce.escrow"],
    {
      cwd: repoRoot,
      shell: true,
      env: process.env,
    },
  );

  let output = "";
  child.stdout.on("data", (d) => {
    output += d.toString();
    process.stdout.write(d);
  });
  child.stderr.on("data", (d) => {
    output += d.toString();
    process.stderr.write(d);
  });

  const code = await new Promise<number>((resolve) => {
    child.on("close", resolve);
  });

  await writeFile(outFile, output, "utf8");
  console.log(`\n[capture] wrote ${outFile} (${output.length} bytes, exit ${code})`);
  process.exit(code === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
