/**
 * Published registry root for gate ZK proofs (Zecathon Week 3).
 *
 * `LIGIS_ZK_ROOT_MANIFEST` points at a manifest JSON produced by
 * `pnpm --filter @ligis/circuits-zcash build-root` (from CredentialRegistry
 * issue/revoke events + subject→identity-commitment registrations). The
 * gate re-derives the root from the manifest's leaves (`checkManifest`), so
 * a tampered file is rejected rather than trusted; staleness is enforced in
 * `evaluateZkCredential` via `LIGIS_ZK_ROOT_MAX_AGE_S`.
 *
 * The same manifest is served at `GET /api/zk/root` so holders can compute
 * their Merkle path against exactly the root the gate trusts.
 */
import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fieldHex } from "@ligis/circuits-zcash/fields";
import { demoRegistry } from "@ligis/circuits-zcash/demo";
import {
  checkManifest,
  type RootManifest,
} from "@ligis/circuits-zcash/registry";
import {
  DEFAULT_MAX_ROOT_AGE_S,
  trustedRootsFromEnv,
  type PublishedRoot,
} from "./zk-credential";

export type LoadedManifest =
  | { manifest: RootManifest; published: PublishedRoot }
  | { error: string };

/** `LIGIS_ZK_ROOT_MANIFEST=demo`: the deterministic public demo registry. */
export const DEMO_MANIFEST = "demo";

let demoCache: { asOf: number; value: LoadedManifest } | undefined;
async function demoManifest(nowS: number): Promise<LoadedManifest> {
  // Rebuilt every 10 minutes so `asOf` stays fresh; the root only changes
  // if a demo credential expires (2031).
  const asOf = nowS - (nowS % 600);
  if (demoCache?.asOf !== asOf) {
    const { manifest } = await demoRegistry(asOf);
    demoCache = {
      asOf,
      value: {
        manifest,
        published: {
          root: BigInt(manifest.root),
          asOf: manifest.asOf,
          leafCount: manifest.leafCount,
        },
      },
    };
  }
  return demoCache.value;
}

let cache: { file: string; mtimeMs: number; value: LoadedManifest } | undefined;

/** `undefined` when no manifest is configured. Cached by file mtime. */
export async function loadRootManifest(
  env: NodeJS.ProcessEnv,
): Promise<LoadedManifest | undefined> {
  const p = env.LIGIS_ZK_ROOT_MANIFEST?.trim();
  if (!p) return undefined;
  if (p === DEMO_MANIFEST) return demoManifest(Math.floor(Date.now() / 1000));
  const file = path.resolve(process.cwd(), p);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    return { error: "LIGIS_ZK_ROOT_MANIFEST file not readable" };
  }
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) {
    return cache.value;
  }
  let value: LoadedManifest;
  try {
    const checked = await checkManifest(
      JSON.parse(await readFile(file, "utf8")),
    );
    value =
      typeof checked === "string"
        ? { error: checked }
        : {
            manifest: checked,
            published: {
              root: BigInt(checked.root),
              asOf: checked.asOf,
              leafCount: checked.leafCount,
            },
          };
  } catch (err) {
    value = {
      error: `manifest parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  cache = { file, mtimeMs, value };
  return value;
}

export function maxRootAgeFromEnv(env: NodeJS.ProcessEnv): number {
  const n = Number(env.LIGIS_ZK_ROOT_MAX_AGE_S);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ROOT_AGE_S;
}

/** Body of `GET /api/zk/root`. */
export async function zkRootInfo(env: NodeJS.ProcessEnv, nowMs = Date.now()) {
  const loaded = await loadRootManifest(env);
  const maxRootAgeS = maxRootAgeFromEnv(env);
  const nowS = Math.floor(nowMs / 1000);
  return {
    circuit: "ligis_credential_membership",
    publicInputs: [
      "registry_root",
      "payee_hash",
      "capability_hash",
      "context",
      "current_time",
      "nullifier",
    ],
    pinnedRoots: trustedRootsFromEnv(env).map(fieldHex),
    maxRootAgeS,
    manifest: !loaded
      ? null
      : "error" in loaded
        ? { status: "invalid" as const, error: loaded.error }
        : {
            status:
              nowS - loaded.published.asOf > maxRootAgeS
                ? ("stale" as const)
                : ("fresh" as const),
            ...loaded.manifest,
          },
  };
}
