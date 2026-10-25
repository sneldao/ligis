/**
 * Production wiring for gate ZK credential proofs: the `bb` verifier from
 * `@ligis/circuits-zcash` and a nullifier store.
 *
 * Nullifier store: Upstash/Vercel-KV (`SET NX`, atomic across instances)
 * when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set; otherwise a
 * process-local memory set (replay protection only within one process —
 * fine for local/dev, not for multi-instance production).
 */
import "server-only";
import { verifyMembershipProof } from "@ligis/circuits-zcash/verify";
import {
  DEFAULT_MAX_PROOF_AGE_S,
  MemoryNullifierStore,
  trustedRootsFromEnv,
  type NullifierClaim,
  type NullifierStore,
  type ZkDeps,
} from "./zk-credential";

class UpstashNullifierStore implements NullifierStore {
  constructor(
    private url: string,
    private token: string,
    private prefix: string,
  ) {}
  private async cmd(args: string[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) throw new Error(`kv ${res.status}`);
    return ((await res.json()) as { result?: unknown }).result;
  }
  async seen(context: string, nullifier: string) {
    try {
      return (
        (await this.cmd([
          "EXISTS",
          `${this.prefix}:${context}:${nullifier}`,
        ])) === 1
      );
    } catch {
      return "unavailable" as const;
    }
  }
  async claim(context: string, nullifier: string): Promise<NullifierClaim> {
    try {
      const r = await this.cmd([
        "SET",
        `${this.prefix}:${context}:${nullifier}`,
        "1",
        "NX",
      ]);
      return r === "OK" ? "claimed" : "replayed";
    } catch {
      return "unavailable";
    }
  }
}

let memoryStore: MemoryNullifierStore | undefined;

export function nullifierStoreFromEnv(env: NodeJS.ProcessEnv): NullifierStore {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (url && token) {
    return new UpstashNullifierStore(
      url,
      token,
      env.LIGIS_ZK_NULLIFIER_KEY ?? "ligis:zk-nullifier",
    );
  }
  memoryStore ??= new MemoryNullifierStore();
  return memoryStore;
}

export function zkDepsFromEnv(env: NodeJS.ProcessEnv): ZkDeps {
  const age = Number(env.LIGIS_ZK_MAX_PROOF_AGE_S);
  return {
    verify: (proof, pub) => verifyMembershipProof(proof, pub, { env }),
    nullifiers: nullifierStoreFromEnv(env),
    trustedRoots: trustedRootsFromEnv(env),
    maxProofAgeS:
      Number.isFinite(age) && age > 0 ? age : DEFAULT_MAX_PROOF_AGE_S,
  };
}
