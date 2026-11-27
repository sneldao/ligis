/**
 * @ligis/adapter-genlayer — Ligis gate + JobEscrow demo runner (Agent Tank).
 *
 * Stream 2: checkLigisGate (Casper/Pharos) — DONE
 * Stream 3: runJobEscrowDemoViaPython + pnpm demo:genlayer — DONE
 *           createJobEscrowClient: address-validated stub until genlayer-js
 *           supports Studio Next (61997) per-method calls
 */

export * from "./interface.js";

export {
  checkLigisGate,
  gateFromVerifyResult,
  refuseIfNotCapable,
  GateRefusedError,
  DEFAULT_GATE_CAPABILITY,
  DEFAULT_GATE_CHAIN,
} from "./check-gate.js";

export {
  createJobEscrowClient,
  type GenLayerAdapterConfig,
  type JobEscrowClient,
} from "./jobescrow-client.js";

export {
  runJobEscrowDemoViaPython,
  parseLastrun,
  DEFAULT_DEPLOY_PY,
  DEFAULT_LASTRUN,
  type RunJobEscrowDemoOptions,
  type JobEscrowLastrun,
} from "./run-demo.js";
