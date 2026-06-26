/**
 * Casper on-chain operations.
 *
 * Mirrors the shape of packages/adapter-evm/src/operations.ts. Each function
 * takes a CasperClientContext and returns plain data — no console.log, no
 * MCP envelope. Callers (CLI, MCP, Agent) shape the I/O.
 *
 * Read paths (verifyCapability, getAgentId) query global state via the RPC
 * client. Write paths build TransactionV1 payloads, sign them with the
 * secp256k1 key from env, submit via putTransaction, and wait for
 * confirmation.
 *
 * The on-chain contracts are Odra modules in packages/contracts-casper:
 *   - AgentId: mint_self, mint, rotate, set_token_uri, owner_of, wallet_of_agent
 *   - CredentialRegistry: issue, revoke, issuer_nonce_of, latest_credential, is_capable
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { CLValue } from "casper-js-sdk";
import { capabilityHash, parseCapability } from "@ligis/core";
import type { CasperClientContext } from "./client.js";
import { buildCredentialDigest, type CredentialMessage } from "./eip712.js";
import { loadSigner, buildStoredContractTransaction, submitAndWait, type Signer } from "./signer.js";

const DEFAULT_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Convert an 0x-prefixed hex string to bytes. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Convert bytes to 0x-prefixed hex. */
function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

/** Derive the secp256k1 Ethereum-style address from a 32-byte private key. */
function addressFromSecpKey(privateKeyHex: string): string {
  const priv = hexToBytes(privateKeyHex);
  const pub = secp256k1.getPublicKey(priv, false); // uncompressed: 0x04 || X || Y
  const hash = keccak_256(pub.slice(1));            // skip the 0x04 prefix
  return bytesToHex(hash.slice(-20));
}

/** Require a deployed contract, throw with a clear message if missing. */
function requireDeployment(ctx: CasperClientContext, which: "agentId" | "credentialRegistry"): string {
  const hash = ctx.config.deployment[which];
  if (!hash) {
    throw new Error(
      `Casper adapter: ${which} contract not deployed. ` +
        `Deploy packages/contracts-casper and set LIGIS_CASPER_${which.toUpperCase()} env var.`,
    );
  }
  return hash;
}

/** Load the signer or throw with a clear message. */
function requireSigner(): Signer {
  return loadSigner();
}

/** Parse an account-hash string to bytes for CLValue construction. */
function accountHashToBytes(accountHash: string): Uint8Array {
  const clean = accountHash.startsWith("account-hash-")
    ? accountHash.slice("account-hash-".length)
    : accountHash.startsWith("0x")
      ? accountHash.slice(2)
      : accountHash;
  return hexToBytes(clean);
}

/** Strip a hash- prefix or 0x prefix and return the raw hex. */
function stripPrefix(hash: string): string {
  return hash.startsWith("hash-")
    ? hash.slice("hash-".length)
    : hash.startsWith("0x")
      ? hash.slice(2)
      : hash;
}

// ---------- identity ----------

/**
 * Read the agent ID (token_id) for a given controller from the AgentId contract.
 * Returns null if the controller has no agent.
 */
export async function getAgentId(
  ctx: CasperClientContext,
  controller: string,
): Promise<string | null> {
  const packageHash = requireDeployment(ctx, "agentId");

  // Query the contract's `wallet_of_agent` dictionary.
  const controllerBytes = accountHashToBytes(controller);
  const dictKey = `hash-${Buffer.from(controllerBytes).toString("hex")}`;

  const stateRoot = await ctx.rpc.getStateRootHashLatest();
  const result = await ctx.rpc.queryGlobalStateByStateHash(
    stateRoot.stateRootHash.toHex(),
    `hash-${stripPrefix(packageHash)}`,
    ["wallet_of_agent", dictKey],
  );

  const tokenId = (result as any)?.value?.CLValue?.parsed?.toString();
  if (!tokenId || tokenId === "0") return null;
  return tokenId;
}

/**
 * Mint a new agent ID on Casper. Calls AgentId.mint_self(token_uri).
 * The controller is the caller (derived from the signer's public key).
 */
export async function issueAgentId(
  ctx: CasperClientContext,
  opts: { controller?: string; tokenUri?: string },
): Promise<{ agentId: string; controller: string; txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "agentId");
  const signer = requireSigner();
  const tokenUri = opts.tokenUri ?? "";

  const signerAccountHash = signer.accountHash;
  const isSelfMint = !opts.controller || opts.controller === signerAccountHash;

  const args = new Map<string, CLValue>();
  args.set("token_uri", CLValue.newCLString(tokenUri));
  if (!isSelfMint) {
    const controllerBytes = accountHashToBytes(opts.controller!);
    args.set("controller", CLValue.newCLByteArray(controllerBytes));
  }

  const entryPoint = isSelfMint ? "mint_self" : "mint";
  const tx = buildStoredContractTransaction({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint,
    args,
  });

  const { txHash, blockNumber } = await submitAndWait(ctx.rpc, tx);

  // Read back the token_id from the contract.
  const controller = opts.controller ?? signerAccountHash;
  const agentId = await getAgentId(ctx, controller);

  return {
    agentId: agentId ?? "0",
    controller,
    txHash,
    blockNumber,
  };
}

/**
 * Rotate the controller of an agent ID. Calls AgentId.rotate(token_id, new_controller).
 */
export async function rotateAgentId(
  ctx: CasperClientContext,
  opts: { agentId: string; newController: string },
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "agentId");
  const signer = requireSigner();

  const args = new Map<string, CLValue>();
  args.set("token_id", CLValue.newCLUint64(BigInt(opts.agentId)));
  const newControllerBytes = accountHashToBytes(opts.newController);
  args.set("new_controller", CLValue.newCLByteArray(newControllerBytes));

  const tx = buildStoredContractTransaction({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "rotate",
    args,
  });

  return submitAndWait(ctx.rpc, tx);
}

// ---------- credentials ----------

/**
 * Verify whether a subject holds a valid (non-expired, non-revoked) capability
 * credential on the CredentialRegistry contract.
 */
export async function verifyCapability(
  ctx: CasperClientContext,
  opts: { subject: string; capability: string; issuer?: string },
): Promise<{
  capable: boolean;
  capabilityHash: `0x${string}`;
  latest: { issuer: string; issuedAt: string; expiresAt: string; revoked: boolean; valid: boolean };
}> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const capHash = parseCapability(opts.capability) as `0x${string}`;

  const subjectBytes = accountHashToBytes(opts.subject);
  const capHashBytes = hexToBytes(capHash);

  // Build the composite dictionary key: subject_bytes || capability_hash_bytes
  const compositeKey = new Uint8Array(subjectBytes.length + capHashBytes.length);
  compositeKey.set(subjectBytes, 0);
  compositeKey.set(capHashBytes, subjectBytes.length);
  const dictKey = `hash-${Buffer.from(compositeKey).toString("hex")}`;

  const stateRoot = await ctx.rpc.getStateRootHashLatest();
  const result = await ctx.rpc.queryGlobalStateByStateHash(
    stateRoot.stateRootHash.toHex(),
    `hash-${stripPrefix(packageHash)}`,
    ["latest", dictKey],
  );

  const clValue = (result as any)?.value?.CLValue;
  if (!clValue) {
    return {
      capable: false,
      capabilityHash: capHash,
      latest: {
        issuer: "0x0000000000000000000000000000000000000000",
        issuedAt: "0",
        expiresAt: "0",
        revoked: false,
        valid: false,
      },
    };
  }

  const view = parseCredentialView(clValue);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const capable = view.valid && !view.revoked && BigInt(view.expiresAt) > now &&
    (!opts.issuer || view.issuer.toLowerCase() === opts.issuer.toLowerCase());

  return {
    capable,
    capabilityHash: capHash,
    latest: view,
  };
}

/** Parse a CredentialView CLValue from the query result. */
function parseCredentialView(clValue: any): {
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  valid: boolean;
} {
  const parsed = clValue.parsed ?? clValue;
  if (typeof parsed === "object" && parsed !== null) {
    const issuerBytes = parsed.issuer ?? parsed.issuer?.bytes ?? new Uint8Array(20);
    const issuerHex = typeof issuerBytes === "string"
      ? issuerBytes
      : bytesToHex(issuerBytes instanceof Uint8Array ? issuerBytes : new Uint8Array(issuerBytes));
    return {
      issuer: issuerHex,
      issuedAt: String(parsed.issued_at ?? parsed.issuedAt ?? 0),
      expiresAt: String(parsed.expires_at ?? parsed.expiresAt ?? 0),
      revoked: Boolean(parsed.revoked ?? false),
      valid: Boolean(parsed.valid ?? false),
    };
  }
  return {
    issuer: "0x0000000000000000000000000000000000000000",
    issuedAt: "0",
    expiresAt: "0",
    revoked: false,
    valid: false,
  };
}

/**
 * Build + sign an EIP-712 credential. The same wire format as the EVM
 * adapter — the only difference is the domain separator (Casper-native fields).
 *
 * The nonce is read from the CredentialRegistry contract if available;
 * otherwise defaults to "0" (for the first credential from this issuer).
 */
export async function signCredential(
  ctx: CasperClientContext,
  opts: { issuerKey: string; subject: string; capability: string; expiresInSeconds?: number },
): Promise<{
  issuer: string;
  subject: string;
  capabilityHash: `0x${string}`;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  digest: `0x${string}`;
  signature: string;
}> {
  const capHash = parseCapability(opts.capability) as `0x${string}`;
  const issuer = addressFromSecpKey(opts.issuerKey);
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + BigInt(opts.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS);

  // Try to read the issuer's nonce from the contract.
  let nonce = "0";
  try {
    const packageHash = ctx.config.deployment.credentialRegistry;
    if (packageHash) {
      const stateRoot = await ctx.rpc.getStateRootHashLatest();
      const issuerKeyHex = stripPrefix(issuer);
      const dictKey = `hash-${issuerKeyHex}`;
      const result = await ctx.rpc.queryGlobalStateByStateHash(
        stateRoot.stateRootHash.toHex(),
        `hash-${stripPrefix(packageHash)}`,
        ["issuer_nonce", dictKey],
      );
      const nonceVal = (result as any)?.value?.CLValue?.parsed?.toString();
      if (nonceVal) nonce = nonceVal;
    }
  } catch {
    // Contract not deployed or query failed — default nonce "0" is fine.
  }

  const message: CredentialMessage = {
    issuer,
    subject: opts.subject,
    capabilityHash: capHash,
    issuedAt: issuedAt.toString(),
    expiresAt: expiresAt.toString(),
    nonce,
  };

  const digest = buildCredentialDigest(ctx.config, message);

  // secp256k1 sign(digest, privKey)
  const priv = hexToBytes(opts.issuerKey);
  const sig = secp256k1.sign(hexToBytes(digest), priv);
  const compact = sig.toCompactRawBytes();
  // EVM-style 65-byte sig: r(32) || s(32) || v(1) where v = 27 + recovery
  const fullSig = new Uint8Array(65);
  fullSig.set(compact, 0);
  fullSig[64] = 27 + (sig.recovery ?? 0);
  const signature = bytesToHex(fullSig);

  return {
    issuer,
    subject: opts.subject,
    capabilityHash: capHash,
    issuedAt: issuedAt.toString(),
    expiresAt: expiresAt.toString(),
    nonce,
    digest,
    signature,
  };
}

/**
 * Submit a signed credential to the CredentialRegistry contract.
 * Calls CredentialRegistry.issue(issuer, subject, cap_hash, issued_at, expires_at, nonce, signature).
 */
export async function submitCredential(
  ctx: CasperClientContext,
  signed: {
    issuer: string;
    subject: string;
    capabilityHash: `0x${string}`;
    issuedAt: string;
    expiresAt: string;
    nonce: string;
    signature: string;
  },
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const signer = requireSigner();

  const issuerBytes = hexToBytes(signed.issuer);
  const subjectBytes = accountHashToBytes(signed.subject);
  const capHashBytes = hexToBytes(signed.capabilityHash);
  const sigBytes = hexToBytes(signed.signature);

  const args = new Map<string, CLValue>();
  args.set("issuer", CLValue.newCLByteArray(issuerBytes));
  args.set("subject", CLValue.newCLByteArray(subjectBytes));
  args.set("capability_hash", CLValue.newCLByteArray(capHashBytes));
  args.set("issued_at", CLValue.newCLUint64(BigInt(signed.issuedAt)));
  args.set("expires_at", CLValue.newCLUint64(BigInt(signed.expiresAt)));
  args.set("nonce", CLValue.newCLUint64(BigInt(signed.nonce)));
  // signature is Vec<u8> — a list of U8 CLValues
  const sigList = Array.from(sigBytes).map((b) => CLValue.newCLUint8(b));
  args.set("signature", CLValue.newCLList(
    { name: "U8", variations: [] } as any,
    sigList,
  ));

  const tx = buildStoredContractTransaction({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "issue",
    args,
  });

  return submitAndWait(ctx.rpc, tx);
}

/**
 * Revoke a credential. Calls CredentialRegistry.revoke(subject, capability_hash, nonce).
 * Only the original issuer can revoke.
 */
export async function revokeCredential(
  ctx: CasperClientContext,
  opts: { subject: string; capability: string; nonce: string; issuerKey?: string },
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const signer = requireSigner();

  const capHash = parseCapability(opts.capability) as `0x${string}`;
  const subjectBytes = accountHashToBytes(opts.subject);
  const capHashBytes = hexToBytes(capHash);

  const args = new Map<string, CLValue>();
  args.set("subject", CLValue.newCLByteArray(subjectBytes));
  args.set("capability_hash", CLValue.newCLByteArray(capHashBytes));
  args.set("nonce", CLValue.newCLUint64(BigInt(opts.nonce)));

  const tx = buildStoredContractTransaction({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "revoke",
    args,
  });

  return submitAndWait(ctx.rpc, tx);
}

// ---------- evidence anchoring ----------

/**
 * Anchor an evidence URI to an agent ID. Calls AgentId.set_token_uri(token_id, uri).
 * This is how 0G Storage evidence manifests are linked to on-chain agent identities.
 */
export async function anchorEvidence(
  ctx: CasperClientContext,
  opts: { agentId: string; uri: string },
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "agentId");
  const signer = requireSigner();

  const args = new Map<string, CLValue>();
  args.set("token_id", CLValue.newCLUint64(BigInt(opts.agentId)));
  args.set("uri", CLValue.newCLString(opts.uri));

  const tx = buildStoredContractTransaction({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "set_token_uri",
    args,
  });

  return submitAndWait(ctx.rpc, tx);
}

// Re-exports for tests / sibling modules
export { capabilityHash };
