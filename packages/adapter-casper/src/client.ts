/**
 * casper-js-sdk client bootstrap.
 *
 * Builds an RpcClient with optional CSPR.cloud auth + signer setup. Signers
 * are loaded lazily from env (LIGIS_STEWARD_KEY or PRIVATE_KEY); the adapter
 * works read-only without one.
 */
import casperSdk from "casper-js-sdk";
import type { RpcClient as RpcClientType } from "casper-js-sdk";
import type { CasperConfig } from "./config.js";

const { HttpHandler, RpcClient, PublicKey } = casperSdk;

export interface CasperClientContext {
  config: CasperConfig;
  rpc: RpcClientType;
  /** Hex public key of the signing wallet (if configured). */
  publicKeyHex: string | null;
  /** Account hash (32-byte hex with `account-hash-` prefix) of the signing wallet. */
  accountHash: string | null;
}

/**
 * Build a CasperClientContext. Does NOT load the private key into memory eagerly;
 * the adapter pulls it from env per-call so it can be rotated without restart.
 */
export function buildCasperClient(config: CasperConfig): CasperClientContext {
  // Use the 'fetch' HTTP client — the default 'axios' backend has issues
  // with some Node.js + ESM configurations. 'fetch' uses the native
  // global fetch() which is stable in Node 20+.
  const handler = new HttpHandler(config.network.rpcUrl, "fetch");
  if (config.network.authToken) {
    handler.setCustomHeaders({ Authorization: config.network.authToken });
  }
  const rpc = new RpcClient(handler);

  // The public key + account hash are populated only if a signer is configured.
  // We don't import the key material here — that happens in `signer.ts` at
  // operation time, so a missing key is a recoverable per-call error rather
  // than a startup failure.
  const publicKeyHex = process.env.LIGIS_CASPER_PUBLIC_KEY
    || process.env.LIGIS_CASPER_DEPLOYER_PUBKEY
    || null;
  const accountHash = publicKeyHex ? publicKeyToAccountHashHex(publicKeyHex) : null;

  return { config, rpc, publicKeyHex, accountHash };
}

/**
 * Derive the `account-hash-...` prefixed hex from a Casper public-key hex.
 */
function publicKeyToAccountHashHex(publicKeyHex: string): string {
  const pub = PublicKey.fromHex(publicKeyHex);
  return pub.accountHash().toPrefixedString();
}
