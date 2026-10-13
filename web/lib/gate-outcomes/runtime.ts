import "server-only";
import { parseCallerGrants } from "./auth";
import { UpstashOutcomeBackend } from "./backend";
import { createRpcProofVerifier } from "./proof";
import { OutcomeRecorder } from "./recorder";

/** All configuration is server-only and off by default. Missing durable
 * storage/auth/HMAC configuration means disabled, never an ephemeral fallback. */
export function loadOutcomeRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.LIGIS_OUTCOMES_ENABLED !== "1") return null;
  const grants = parseCallerGrants(env.LIGIS_OUTCOME_CALLERS_JSON);
  const hashKey = env.LIGIS_OUTCOME_HASH_KEY;
  if (
    !grants ||
    !hashKey ||
    hashKey.length < 32 ||
    !env.KV_REST_API_URL ||
    !env.KV_REST_API_TOKEN
  )
    return null;
  try {
    let verifier;
    // Receipt verification is separately opt-in. Ingestion still works without
    // it, but can only record explicitly unverified transaction reports.
    if (env.LIGIS_OUTCOME_RPC_ENABLED === "1") {
      const chainId = Number(env.LIGIS_OUTCOME_RPC_CHAIN_ID);
      const assets: unknown = JSON.parse(
        env.LIGIS_OUTCOME_ASSETS_JSON ?? "null",
      );
      if (
        !env.LIGIS_OUTCOME_RPC_URL ||
        !Array.isArray(assets) ||
        !assets.every((a) => typeof a === "string")
      )
        return null;
      verifier = createRpcProofVerifier({
        url: env.LIGIS_OUTCOME_RPC_URL,
        chainId,
        assets,
      });
    }
    return {
      grants,
      recorder: new OutcomeRecorder({
        enabled: true,
        grants,
        hashKey,
        verifier,
        backend: new UpstashOutcomeBackend(
          env.KV_REST_API_URL,
          env.KV_REST_API_TOKEN,
        ),
      }),
    };
  } catch {
    return null;
  }
}
