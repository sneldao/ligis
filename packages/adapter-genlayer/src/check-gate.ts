/**
 * Stream 2 — Ligis gate → GateReceipt.
 *
 * Implements `checkLigisGate` against the frozen interface in
 * `docs/genlayer-interface-v1.md`. Calls Ligis `verifyCapability` on the
 * configured chain (Casper by default, Pharos opt-in via the
 * `ligisChain` argument or `LIGIS_GENLAYER_GATE_CHAIN` env var) and emits
 * a {@link GateReceipt} that the JobEscrow Intelligent Contract on
 * GenLayer Studio Next can store as the eligibility proof (Option A:
 * pre-flight Ligis + stored receipt).
 *
 * This is the load-bearing piece of the Agent Tank submission: the Ligis
 * gate verdict lands inside the IC's job state, not only in the demo
 * voiceover. Stream 3's orchestrator must call `checkLigisGate` and refuse
 * to submit `create_job` when `capable === false` — the contract also
 * asserts the boolean, so a bypass would revert anyway.
 */
import {
  buildGateReceipt,
  capabilityHash,
  GENLAYER_DEFAULT_CAPABILITY,
  GENLAYER_DEFAULT_LIGIS_CHAIN,
  type CheckLigisGateInput,
  type GateReceipt,
  type VerifyResult,
} from "@ligis/core";
import { CasperAdapter } from "@ligis/adapter-casper";
import { EvmAdapter } from "@ligis/adapter-evm";

/**
 * Default Ligis chain used when `input.ligisChain` and
 * `LIGIS_GENLAYER_GATE_CHAIN` are both unset. Mirrors
 * {@link GENLAYER_DEFAULT_LIGIS_CHAIN}.
 */
export const DEFAULT_GATE_CHAIN = GENLAYER_DEFAULT_LIGIS_CHAIN;

/** Default capability checked when `input.capability` is unset. */
export const DEFAULT_GATE_CAPABILITY = GENLAYER_DEFAULT_CAPABILITY;

/**
 * Error thrown by {@link refuseIfNotCapable} when the gate says STOP.
 * Carries the receipt so the orchestrator can echo it to the demo log
 * and let the UI surface the verdict even when `create_job` was never
 * called.
 */
export class GateRefusedError extends Error {
  readonly receipt: GateReceipt;
  constructor(receipt: GateReceipt) {
    super(
      `Ligis gate STOP: subject=${receipt.subject} ` +
        `capability=${receipt.capability} chain=${receipt.ligisChain} ` +
        `proof_ref=${receipt.proofRef}`,
    );
    this.name = "GateRefusedError";
    this.receipt = receipt;
  }
}

/** Resolve the chain to gate on from process.env. */
function resolveChainOverride(): string | undefined {
  const raw = process.env.LIGIS_GENLAYER_GATE_CHAIN;
  if (!raw || raw.trim().length === 0) return undefined;
  return raw.trim();
}

/**
 * Build a GateReceipt from a pre-computed VerifyResult. Useful for tests,
 * mock runs, and Stream 4's "preview without RPC" UI mode. Exposed so
 * downstream code doesn't have to round-trip through the adapter.
 */
export function gateFromVerifyResult(
  verify: VerifyResult,
  chain: string,
  subject: string,
  capability: string,
  proofRef?: string,
): GateReceipt {
  return buildGateReceipt({
    subject,
    capability,
    capable: verify.capable,
    ligisChain: chain,
    proofRef: proofRef ?? buildProofRef(chain, verify.capabilityHash, subject),
    checkedAt: Math.floor(Date.now() / 1000),
    capabilityHash: verify.capabilityHash ?? capabilityHash(capability),
  });
}

/** Build the proof_ref the IC will store. Prefers an explorer URL. */
function buildProofRef(
  chain: string,
  capHash: string,
  subject: string,
): string {
  if (chain === "casper-testnet" || chain === "casper-mainnet") {
    return `https://testnet.cspr.live/gate?capability=${capHash}&subject=${encodeURIComponent(
      subject,
    )}`;
  }
  if (chain === "pharos-atlantic" || chain === "atlantic-testnet") {
    return `https://atlantic.pharosscan.xyz/gate?capability=${capHash}&subject=${encodeURIComponent(
      subject,
    )}`;
  }
  // Last resort — still stable + judge-openable.
  return `verify:${chain}:${capHash}:${subject}`;
}

/**
 * Run the Ligis gate and emit a {@link GateReceipt} the IC will accept.
 * Default capability is `agent.commerce.escrow`; default chain is
 * `casper-testnet`. Never throws on `capable === false` — the orchestrator
 * decides whether to refuse via {@link refuseIfNotCapable}.
 */
export async function checkLigisGate(
  input: CheckLigisGateInput,
): Promise<GateReceipt> {
  const subject = String(input.subject ?? "").trim();
  if (!subject) {
    throw new Error("checkLigisGate: subject is required");
  }
  const capability = input.capability || DEFAULT_GATE_CAPABILITY;
  const ligisChain =
    input.ligisChain || resolveChainOverride() || DEFAULT_GATE_CHAIN;

  let verify: VerifyResult;
  if (
    ligisChain === "casper-testnet" ||
    ligisChain === "casper-mainnet" ||
    ligisChain === "casper"
  ) {
    const adapter = new CasperAdapter();
    verify = await adapter.verifyCapability({ subject, capability });
  } else if (
    ligisChain === "pharos-atlantic" ||
    ligisChain === "atlantic-testnet" ||
    ligisChain === "pharos-mainnet" ||
    ligisChain === "mainnet" ||
    ligisChain === "pharos"
  ) {
    const adapter = new EvmAdapter();
    verify = await adapter.verifyCapability({ subject, capability });
  } else {
    throw new Error(
      `checkLigisGate: unsupported ligisChain '${ligisChain}' ` +
        `(supported: casper-testnet, pharos-atlantic, casper-mainnet, pharos-mainnet)`,
    );
  }

  return buildGateReceipt({
    subject,
    capability,
    capable: verify.capable,
    ligisChain,
    proofRef: buildProofRef(
      ligisChain,
      verify.capabilityHash ?? capabilityHash(capability),
      subject,
    ),
    checkedAt: Math.floor(Date.now() / 1000),
    capabilityHash: verify.capabilityHash ?? capabilityHash(capability),
  });
}

/**
 * Run the gate; throw {@link GateRefusedError} if STOP. Return the GO
 * receipt otherwise. The orchestrator must call this right before
 * submitting `create_job` and let the error propagate up so the demo log
 * can record both the receipt and the refusal.
 */
export async function refuseIfNotCapable(
  input: CheckLigisGateInput,
): Promise<GateReceipt> {
  const receipt = await checkLigisGate(input);
  if (!receipt.capable) {
    throw new GateRefusedError(receipt);
  }
  return receipt;
}
