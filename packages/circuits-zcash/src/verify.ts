/**
 * Server-side verification of a membership proof with the `bb` CLI and the
 * committed verification key. Needs only `bb` (not nargo). Never throws for
 * a missing toolchain: it reports `unavailable` so callers can surface an
 * explicit unverified state instead of passing silently.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PUBLIC_INPUT_ORDER,
  fieldHex,
  type MembershipPublicInputs,
} from "./fields.js";
import { MEMBERSHIP_VK_BASE64 } from "./vk.js";

const run = promisify(execFile);

export const PINNED_BB = "5.0.0-nightly.20260522";

export type BbResolution =
  | { ok: true; bb: string; version: string }
  | { ok: false; reason: string };

const cache = new Map<string, BbResolution>();

async function bbVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await run(bin, ["--version"], { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Locate a `bb` compatible with the pinned version. When `LIGIS_ZK_BB_BIN`
 * (or `BB_BIN`) is set, ONLY that path is tried. Otherwise:
 * `~/.bb-versions/<pinned>/bb`, then `bb` on PATH. Cached per process.
 */
export async function resolveBb(
  env: Record<string, string | undefined> = process.env,
): Promise<BbResolution> {
  const explicit = env.LIGIS_ZK_BB_BIN ?? env.BB_BIN;
  const key = explicit ?? "";
  const hit = cache.get(key);
  if (hit) return hit;
  const candidates = explicit
    ? [explicit]
    : [join(homedir(), ".bb-versions", PINNED_BB, "bb"), "bb"].filter(
        (c) => c === "bb" || existsSync(c),
      );
  let out: BbResolution = {
    ok: false,
    reason: explicit
      ? `bb not runnable at ${explicit}`
      : `bb ${PINNED_BB} not found (set LIGIS_ZK_BB_BIN)`,
  };
  for (const bin of candidates) {
    const v = await bbVersion(bin);
    if (!v) continue;
    if (v.split(".")[0] !== PINNED_BB.split(".")[0]) {
      out = {
        ok: false,
        reason: `bb ${v} at ${bin} is incompatible with ${PINNED_BB}`,
      };
      continue;
    }
    out = { ok: true, bb: bin, version: v };
    break;
  }
  cache.set(key, out);
  return out;
}

export function encodePublicInputs(pub: MembershipPublicInputs): Uint8Array {
  const buf = new Uint8Array(32 * PUBLIC_INPUT_ORDER.length);
  PUBLIC_INPUT_ORDER.forEach((k, i) => {
    const hex = fieldHex(pub[k]).slice(2);
    for (let j = 0; j < 32; j++)
      buf[i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
  });
  return buf;
}

export type VerifyOutcome =
  | { status: "verified"; verifier: string; latencyMs: number }
  | { status: "invalid"; verifier: string; latencyMs: number; detail: string }
  | { status: "unavailable"; detail: string };

/** Verify an UltraHonk proof of the membership circuit. */
export async function verifyMembershipProof(
  proof: Uint8Array,
  pub: MembershipPublicInputs,
  opts: { env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<VerifyOutcome> {
  const bb = await resolveBb(opts.env);
  if (!bb.ok) return { status: "unavailable", detail: bb.reason };
  const verifier = `bb ${bb.version} ultra_honk`;
  const t0 = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "ligis-zk-"));
  try {
    await Promise.all([
      writeFile(join(dir, "vk"), Buffer.from(MEMBERSHIP_VK_BASE64, "base64")),
      writeFile(join(dir, "proof"), proof),
      writeFile(join(dir, "public_inputs"), encodePublicInputs(pub)),
    ]);
    try {
      await run(
        bb.bb,
        [
          "verify",
          "-k",
          join(dir, "vk"),
          "-p",
          join(dir, "proof"),
          "-i",
          join(dir, "public_inputs"),
        ],
        { timeout: opts.timeoutMs ?? 10_000 },
      );
      return { status: "verified", verifier, latencyMs: Date.now() - t0 };
    } catch (err) {
      const e = err as { killed?: boolean; stderr?: string; stdout?: string };
      if (e.killed)
        return { status: "unavailable", detail: "bb verify timed out" };
      const tail =
        `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").pop() ?? "";
      return {
        status: "invalid",
        verifier,
        latencyMs: Date.now() - t0,
        detail: tail.slice(0, 200) || "bb verify rejected the proof",
      };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
