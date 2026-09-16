/**
 * @ligis/adapter-genlayer — Ligis gate + JobEscrow demo runner (Agent Tank).
 *
 * Stream 2: checkLigisGate (Casper/Pharos) — DONE
 * Stream 3: runJobEscrowDemoViaPython + pnpm demo:genlayer — DONE
 *           createJobEscrowClient: address-validated stub until genlayer-js
 *           supports Studio Next (61997) per-method calls
 */

import {
  GENLAYER_DEFAULT_CAPABILITY,
  GENLAYER_DEFAULT_LIGIS_CHAIN,
  GENLAYER_STUDIO_NEXT,
  createJobCallArgs,
  gateReceiptToJsonString,
  jobViewFromContract,
} from "@ligis/core";

export {
  GENLAYER_DEFAULT_CAPABILITY,
  GENLAYER_DEFAULT_LIGIS_CHAIN,
  GENLAYER_STUDIO_NEXT,
  createJobCallArgs,
  gateReceiptToJsonString,
  jobViewFromContract,
};

export {
  checkLigisGate,
  gateFromVerifyResult,
  refuseIfNotCapable,
  GateRefusedError,
  DEFAULT_GATE_CAPABILITY,
  DEFAULT_GATE_CHAIN,
} from "./check-gate.js";
export type { CheckLigisGateInput, GateReceipt, JobView } from "@ligis/core";

export {
  createJobEscrowClient,
  type GenLayerAdapterConfig,
  type JobEscrowClient,
} from "./jobescrow-client.js";
export type { CreateJobArgs } from "@ligis/core";

export {
  runJobEscrowDemoViaPython,
  parseLastrun,
  DEFAULT_DEPLOY_PY,
  DEFAULT_LASTRUN,
  type RunJobEscrowDemoOptions,
  type JobEscrowLastrun,
} from "./run-demo.js";
