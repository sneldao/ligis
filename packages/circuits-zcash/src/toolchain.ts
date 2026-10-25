/**
 * Thin wrappers over the `nargo` and `bb` CLIs (no WASM prover in-process).
 * `bb` must match the pinned nargo version (see package.json `toolchain`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_INPUT_ORDER,
  toProverToml,
  type CircuitInputs,
} from "./index.js";

const PINNED_BB = "5.0.0-nightly.20260522";
const CIRCUIT_NAME = "ligis_credential_membership";

export const CIRCUIT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "circuit",
);

export type Toolchain = { nargo: string; bb: string; bbVersion: string };

function version(bin: string): string | null {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Locate nargo + a compatible bb. bb order: `$BB_BIN`, then
 * `~/.bb-versions/<pinned>/bb`, then `bb` on PATH. Returns a reason string
 * when the toolchain is missing or incompatible.
 */
export function resolveToolchain(): Toolchain | string {
  const nargo = process.env.NARGO_BIN ?? "nargo";
  if (!version(nargo)) return "nargo not found (install with noirup)";
  const candidates = [
    process.env.BB_BIN,
    join(homedir(), ".bb-versions", PINNED_BB, "bb"),
    "bb",
  ].filter((c): c is string => !!c && (c === "bb" || existsSync(c)));
  for (const bb of candidates) {
    const v = version(bb);
    if (v && v.split(".")[0] === PINNED_BB.split(".")[0]) {
      return { nargo, bb, bbVersion: v };
    }
  }
  return `no bb compatible with ${PINNED_BB} (set BB_BIN or install into ~/.bb-versions/${PINNED_BB})`;
}

export type ProofResult = {
  verified: boolean;
  proofBytes: number;
  publicInputs: `0x${string}`[];
  outDir: string;
};

/**
 * Write `<name>.toml`, `nargo execute`, `bb prove --write_vk`, `bb verify`.
 * Throws if witness generation fails (i.e. the holder is not eligible).
 */
export function proveAndVerify(
  tc: Toolchain,
  inputs: CircuitInputs,
  name = "Prover",
): ProofResult {
  const run = (bin: string, args: string[]) =>
    execFileSync(bin, args, {
      cwd: CIRCUIT_DIR,
      encoding: "utf8",
      stdio: "pipe",
    });
  writeFileSync(join(CIRCUIT_DIR, `${name}.toml`), toProverToml(inputs));
  run(tc.nargo, ["execute", "--prover-name", name, name]);
  const outDir = join(CIRCUIT_DIR, "target", name);
  mkdirSync(outDir, { recursive: true });
  run(tc.bb, [
    "prove",
    "-b",
    join("target", `${CIRCUIT_NAME}.json`),
    "-w",
    join("target", `${name}.gz`),
    "-o",
    outDir,
    "--write_vk",
  ]);
  let verified = true;
  try {
    run(tc.bb, [
      "verify",
      "-k",
      join(outDir, "vk"),
      "-p",
      join(outDir, "proof"),
      "-i",
      join(outDir, "public_inputs"),
    ]);
  } catch {
    verified = false;
  }
  const raw = readFileSync(join(outDir, "public_inputs"));
  const publicInputs: `0x${string}`[] = [];
  for (let i = 0; i < raw.length; i += 32) {
    publicInputs.push(`0x${raw.subarray(i, i + 32).toString("hex")}`);
  }
  if (publicInputs.length !== PUBLIC_INPUT_ORDER.length) {
    throw new Error(
      `expected ${PUBLIC_INPUT_ORDER.length} public inputs, got ${publicInputs.length}`,
    );
  }
  return {
    verified,
    proofBytes: readFileSync(join(outDir, "proof")).length,
    publicInputs,
    outDir,
  };
}
