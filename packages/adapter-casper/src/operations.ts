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
import { keccak_256 } from "@noble/hashes/sha3.js";
import { blake2b } from "@noble/hashes/blake2.js";
import casperSdk from "casper-js-sdk";
import type { CLValue as CLValueType } from "casper-js-sdk";
const { CLValue, PublicKey, PurseIdentifier } = casperSdk;
import {
  canonicalizeClaim,
  capabilityHash,
  claimHash,
  namespaceHash,
  namespaceHashOf,
  parseCredentialViewHex,
} from "@ligis/core";
import type { CasperClientContext } from "./client.js";
import {
  buildCredentialDigest,
  buildRevokeDigest,
  type CredentialMessage,
  type RevocationMessage,
} from "./eip712.js";
import {
  loadSigner,
  callStoredContractViaCli,
  callStoredContractViaSdk,
  type Signer,
} from "./signer.js";
import {
  getDictionaryItemByContractNamedKey,
  getDictionaryItemByURef,
  getStateRootHash,
  resolveContractState,
} from "./state-reads.js";

const DEFAULT_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Convert an 0x-prefixed hex string to bytes. */
/** Minimal-length even hex for EIP-712 uint fields (padStart(2) alone leaves
 * odd-length strings for values >= 0x100, which the encoder rejects). */
function evenHex(v: bigint): string {
  const h = v.toString(16);
  return h.length % 2 ? `0${h}` : h;
}

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
  const hash = keccak_256(pub.slice(1)); // skip the 0x04 prefix
  return bytesToHex(hash.slice(-20));
}

/** Require a deployed contract, throw with a clear message if missing. */
function requireDeployment(
  ctx: CasperClientContext,
  which: "agentId" | "credentialRegistry" | "outcomeFeed" | "policyGuard",
): string {
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

/** Strip the account-hash- prefix from an account hash string. */
function stripAccountHashPrefix(hash: string): string {
  return hash.replace(/^account-hash-/, "").replace(/^0x/, "");
}

/** Strip a hash- prefix or 0x prefix and return the raw hex. */
function stripPrefix(hash: string): string {
  return hash
    .replace(/^contract-package-/, "")
    .replace(/^hash-/, "")
    .replace(/^0x/, "");
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

  // Try querying the contract's state dictionary via casper-client.
  // Odra stores mappings as dictionaries under the contract's named keys.
  // The dictionary name is the mapping variable name (e.g. "wallet_of_agent").
  // The dictionary item key is the raw bytes of the controller's account hash.
  try {
    const controllerBytes = accountHashToBytes(controller);
    const dictItemKey = Buffer.from(controllerBytes).toString("hex");

    const rpcUrl = ctx.config.network.rpcUrl;
    const authToken = ctx.config.network.authToken;

    const stateRoot = await getStateRootHash(rpcUrl, authToken);
    const { contractHash } = await resolveContractState(
      rpcUrl,
      packageHash,
      authToken,
    );
    const cl = await getDictionaryItemByContractNamedKey(
      rpcUrl,
      stateRoot,
      contractHash,
      "wallet_of_agent",
      dictItemKey,
      authToken,
    );
    const parsed = cl?.parsed;
    if (typeof parsed === "string" && parsed !== "0") return parsed;
    if (typeof parsed === "number" && parsed !== 0) return String(parsed);
    return null;
  } catch (err) {
    // Dictionary query failed — contract may not have the mapping yet.
    // Surface the cause once for debugging, but always return null so
    // the caller can treat "no record on chain" as a steady-state result.
    if (process.env.LIGIS_CASPER_DEBUG) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ligis-casper] getAgentId lookup failed: ${msg}`);
    }
    return null;
  }
}

/**
 * Mint a new agent ID on Casper. Calls AgentId.mint_self(token_uri).
 * The controller is the caller (derived from the signer's public key).
 */
export async function issueAgentId(
  ctx: CasperClientContext,
  opts: { controller?: string; tokenUri?: string },
): Promise<{
  agentId: string;
  controller: string;
  txHash: string;
  blockNumber: string;
}> {
  const packageHash = requireDeployment(ctx, "agentId");
  const signer = requireSigner();
  const tokenUri = opts.tokenUri ?? "";

  const signerAccountHash = signer.accountHash;
  const isSelfMint = !opts.controller || opts.controller === signerAccountHash;

  const args = new Map<string, CLValueType>();
  args.set("token_uri", CLValue.newCLString(tokenUri));
  if (!isSelfMint) {
    const controllerBytes = accountHashToBytes(opts.controller!);
    args.set("controller", CLValue.newCLByteArray(controllerBytes));
  }

  const entryPoint = isSelfMint ? "mint_self" : "mint";
  const { txHash, blockNumber } = await callStoredContractViaCli({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint,
    args,
    rpcUrl: ctx.config.network.rpcUrl,
  });

  // Read back the token_id from the contract.
  // Note: Odra's storage scheme makes dictionary reads complex.
  // If the read fails, assume token_id 1 (first mint).
  const controller = opts.controller ?? signerAccountHash;
  const agentId = await getAgentId(ctx, controller);

  return {
    agentId: agentId ?? "1",
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

  const args = new Map<string, CLValueType>();
  args.set("token_id", CLValue.newCLUint64(BigInt(opts.agentId)));
  const newControllerBytes = accountHashToBytes(opts.newController);
  args.set("new_controller", CLValue.newCLByteArray(newControllerBytes));

  return callStoredContractViaCli({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "rotate",
    args,
    rpcUrl: ctx.config.network.rpcUrl,
  });
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
  latest: {
    issuer: string;
    claim: string;
    issuedAt: string;
    expiresAt: string;
    revoked: boolean;
    valid: boolean;
  };
}> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  // v2: opts.capability is a claim string; canonicalize before hashing so
  // "a.b:x=1" and "a.b:x=1" (any param order) land on the same hash.
  const claim = canonicalizeClaim(opts.capability);
  const capHash = claimHash(claim) as `0x${string}`;

  // Pad subject to 32 bytes — EVM addresses (20 bytes) must be left-padded
  // to match the 32-byte key used by the on-chain CredentialRegistry.
  const subjectRaw = stripAccountHashPrefix(opts.subject);
  const subjectPadded =
    subjectRaw.length === 64 ? subjectRaw : subjectRaw.padStart(64, "0");
  const subjectBytes = hexToBytes(subjectPadded);
  const capHashBytes = hexToBytes(capHash);

  // Odra storage key computation:
  // - The `latest` mapping is at field index 2 in the CredentialRegistry module
  //   (index 0 = module root, 1 = issuer_nonce, 2 = latest)
  // - index_bytes = u32 big-endian of the path (2 → [0,0,0,2])
  // - mapping_data = key.to_bytes() = subject(32) ++ cap_hash(32)
  // - final_key = index_bytes ++ mapping_data
  // - dict_item_key = blake2b(final_key, 32)
  // - The dictionary URef is the contract's `state` URef
  try {
    const rpcUrl = ctx.config.network.rpcUrl;
    const authToken = ctx.config.network.authToken;

    // 1. Resolve the package to its latest contract + state URef, and
    //    fetch the state root — direct JSON-RPC, no CLI output parsing.
    const [{ stateUref }, stateRoot] = await Promise.all([
      resolveContractState(rpcUrl, packageHash, authToken),
      getStateRootHash(rpcUrl, authToken),
    ]);

    // 2. Compute the Odra dictionary item key
    const indexBytes = Buffer.alloc(4);
    indexBytes.writeUInt32BE(2, 0); // field index 2 for `latest`
    const mappingData = Buffer.concat([
      Buffer.from(subjectBytes),
      Buffer.from(capHashBytes),
    ]);
    const finalKey = Buffer.concat([indexBytes, mappingData]);
    const dictItemKey = Buffer.from(blake2b(finalKey, { dkLen: 32 })).toString(
      "hex",
    );

    // 3. Query the dictionary item — Odra stores CredentialView as
    //    List<U8> (raw bytes). A missing key means no credential.
    const clValue = await getDictionaryItemByURef(
      rpcUrl,
      stateRoot,
      stateUref,
      dictItemKey,
      authToken,
    );
    if (!clValue?.bytes) throw new Error("No CLValue in response");

    const view = parseCredentialViewBytes(clValue);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const capable =
      view.valid &&
      !view.revoked &&
      BigInt(view.expiresAt) > now &&
      (!opts.issuer || view.issuer.toLowerCase() === opts.issuer.toLowerCase());

    return {
      capable,
      capabilityHash: capHash,
      latest: view,
    };
  } catch (err) {
    // Dictionary query failed — credential not found or query not supported.
    if (process.env.LIGIS_CASPER_DEBUG) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ligis-casper] verifyCapability lookup failed: ${msg}`);
    }
    return {
      capable: false,
      capabilityHash: capHash,
      latest: {
        issuer: "0x0000000000000000000000000000000000000000",
        claim: "",
        issuedAt: "0",
        expiresAt: "0",
        revoked: false,
        valid: false,
      },
    };
  }
}

/**
 * Read the full issuer standing for a (subject, claim) pair — the off-chain
 * mirror of the contract's `credential_standing` entry point, reconstructed
 * from raw dictionary reads (Casper entry points can only run in a deploy).
 *
 * Field indices follow the struct order in credential_registry.rs:
 *   issuer_nonce=1, latest=2, admin=3, issuer_accreditation=4,
 *   namespace_policy=5, domain_separator=6
 */
export async function credentialStanding(
  ctx: CasperClientContext,
  opts: { subject: string; claim: string },
): Promise<{
  view: ReturnType<typeof parseCredentialViewBytes> | null;
  accreditationRequired: boolean | null;
  issuerAccredited: boolean | null;
  /** true only when standing requirements are met (fail-closed). */
  standing: boolean;
}> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const claim = canonicalizeClaim(opts.claim);
  const capHash = claimHash(claim) as `0x${string}`;
  const nsHash = namespaceHash(claim);

  const subjectRaw = stripAccountHashPrefix(opts.subject);
  const subjectBytes = hexToBytes(
    subjectRaw.length === 64 ? subjectRaw : subjectRaw.padStart(64, "0"),
  );

  try {
    const rpcUrl = ctx.config.network.rpcUrl;
    const authToken = ctx.config.network.authToken;

    const [{ stateUref }, stateRoot] = await Promise.all([
      resolveContractState(rpcUrl, packageHash, authToken),
      getStateRootHash(rpcUrl, authToken),
    ]);

    const readItem = async (
      index: number,
      keyBytes: Uint8Array,
    ): Promise<Buffer | null> => {
      const indexBytes = Buffer.alloc(4);
      indexBytes.writeUInt32BE(index, 0);
      const dictItemKey = Buffer.from(
        blake2b(Buffer.concat([indexBytes, Buffer.from(keyBytes)]), {
          dkLen: 32,
        }),
      ).toString("hex");
      const cl = await getDictionaryItemByURef(
        rpcUrl,
        stateRoot,
        stateUref,
        dictItemKey,
        authToken,
      );
      return cl?.bytes ? Buffer.from(cl.bytes, "hex") : null;
    };

    // latest[subject, claim_hash] → CredentialView
    const viewBytes = await readItem(
      2,
      new Uint8Array([...subjectBytes, ...hexToBytes(capHash)]),
    );
    const view = viewBytes
      ? parseCredentialViewBytes({ bytes: viewBytes.toString("hex") })
      : null;

    // namespace_policy[ns_hash] → bool (u32 len prefix + 1 byte)
    const policyBytes = await readItem(5, hexToBytes(nsHash));
    const accreditationRequired =
      policyBytes && policyBytes.length >= 5 ? policyBytes[4] !== 0 : null;

    // issuer_accreditation[issuer, ns_hash] → AccreditationView{active, granted_at}
    let issuerAccredited: boolean | null = null;
    if (view) {
      const accBytes = await readItem(
        4,
        new Uint8Array([...hexToBytes(view.issuer), ...hexToBytes(nsHash)]),
      );
      issuerAccredited =
        accBytes && accBytes.length >= 5 ? accBytes[4] !== 0 : false;
    }

    const standing =
      accreditationRequired === false ||
      (accreditationRequired === true && issuerAccredited === true);

    return { view, accreditationRequired, issuerAccredited, standing };
  } catch (err) {
    if (process.env.LIGIS_CASPER_DEBUG) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ligis-casper] credentialStanding lookup failed: ${msg}`);
    }
    return {
      view: null,
      accreditationRequired: null,
      issuerAccredited: null,
      standing: false,
    };
  }
}

/** Parse a CredentialView stored as List<U8> bytes (v1 and v2 layouts).
 *
 * Delegates to the dependency-free shared decoder in @ligis/core — the
 * same code the browser adapter uses — and preserves this adapter's
 * historical contract of returning the zeroed "empty" view instead of
 * null for malformed input (callers treat valid:false as not capable).
 */
export function parseCredentialViewBytes(clValue: any): {
  issuer: string;
  claim: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  valid: boolean;
} {
  const view = parseCredentialViewHex(clValue?.bytes ?? "");
  if (view) {
    return { ...view, claim: view.claim ?? "" };
  }
  return {
    issuer: "0x" + "00".repeat(20),
    claim: "",
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
  opts: {
    issuerKey: string;
    subject: string;
    capability: string;
    expiresInSeconds?: number;
  },
): Promise<{
  issuer: string;
  subject: string;
  claim: string;
  capabilityHash: `0x${string}`;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  digest: `0x${string}`;
  signature: string;
}> {
  const claim = canonicalizeClaim(opts.capability);
  const capHash = claimHash(claim) as `0x${string}`;
  const issuer = addressFromSecpKey(opts.issuerKey);
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt =
    issuedAt + BigInt(opts.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS);

  // Try to read the issuer's nonce from the contract.
  // Odra stores the `issuer_nonce` mapping at field index 1.
  // The dictionary key is blake2b(index_bytes ++ issuer_bytes) where
  // index_bytes = u32 BE of 1.
  let nonce = "0";
  try {
    const packageHash = ctx.config.deployment.credentialRegistry;
    if (packageHash) {
      const rpcUrl = ctx.config.network.rpcUrl;
      const authToken = ctx.config.network.authToken;

      const { stateUref } = await resolveContractState(
        rpcUrl,
        packageHash,
        authToken,
      );

      // Compute dictionary item key for issuer_nonce mapping (index 1)
      const issuerBytes = Buffer.from(stripPrefix(issuer), "hex");
      const indexBytes = Buffer.alloc(4);
      indexBytes.writeUInt32BE(1, 0); // field index 1 for `issuer_nonce`
      const finalKey = Buffer.concat([indexBytes, issuerBytes]);
      const dictItemKey = Buffer.from(
        blake2b(finalKey, { dkLen: 32 }),
      ).toString("hex");

      const stateRoot = await getStateRootHash(rpcUrl, authToken);
      const clValue = await getDictionaryItemByURef(
        rpcUrl,
        stateRoot,
        stateUref,
        dictItemKey,
        authToken,
      );
      if (clValue?.bytes) {
        // Odra stores U64 as List<U8>: 4-byte length prefix + 8-byte LE value
        const buf = Buffer.from(clValue.bytes, "hex");
        nonce = buf.readBigUInt64LE(4).toString();
      }
    }
  } catch (err) {
    // Contract not deployed or query failed — default nonce "0" is fine.
    if (process.env.LIGIS_CASPER_DEBUG) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ligis-casper] nonce lookup failed: ${msg}`);
    }
  }

  // Subject must be 32 bytes for EIP-712 bytes32. EVM addresses (20 bytes)
  // are left-padded to 32 bytes. Casper account hashes are already 32 bytes.
  const subjectHex = stripAccountHashPrefix(opts.subject);
  const subjectPadded =
    subjectHex.length === 64 ? subjectHex : subjectHex.padStart(64, "0");

  const message: CredentialMessage = {
    issuer,
    subject: `0x${subjectPadded}`,
    claim,
    issuedAt: evenHex(issuedAt),
    expiresAt: evenHex(expiresAt),
    nonce: evenHex(BigInt(nonce)),
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
    claim,
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
 * Calls CredentialRegistry.issue(issuer, subject, claim, issued_at, expires_at, nonce, digest, signature).
 * v2: the contract derives claim_hash from the canonical `claim` string and
 * recomputes the digest, so `digest` must match the exact typed data.
 */
export async function submitCredential(
  ctx: CasperClientContext,
  signed: {
    issuer: string;
    subject: string;
    claim: string;
    issuedAt: string;
    expiresAt: string;
    nonce: string;
    digest: `0x${string}`;
    signature: string;
  },
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const signer = requireSigner();

  const issuerBytes = hexToBytes(signed.issuer);
  // Pad subject to 32 bytes for the on-chain contract (same as signCredential).
  const subjectRaw = stripAccountHashPrefix(signed.subject);
  const subjectPadded =
    subjectRaw.length === 64 ? subjectRaw : subjectRaw.padStart(64, "0");
  const subjectBytes = hexToBytes(subjectPadded);
  const digestBytes = hexToBytes(signed.digest);
  const sigBytes = hexToBytes(signed.signature);

  const args = new Map<string, CLValueType>();
  args.set("issuer", CLValue.newCLByteArray(issuerBytes));
  args.set("subject", CLValue.newCLByteArray(subjectBytes));
  args.set("claim", CLValue.newCLString(canonicalizeClaim(signed.claim)));
  args.set("issued_at", CLValue.newCLUint64(BigInt(signed.issuedAt)));
  args.set("expires_at", CLValue.newCLUint64(BigInt(signed.expiresAt)));
  args.set("nonce", CLValue.newCLUint64(BigInt(signed.nonce)));
  args.set("digest", CLValue.newCLByteArray(digestBytes));
  // signature is [u8; 65] on the contract — fixed-size ByteArray
  args.set("signature", CLValue.newCLByteArray(sigBytes));

  // Use SDK-based submission (no casper-client CLI required).
  // Falls back to CLI if the SDK submission fails and casper-client is available.
  try {
    return await callStoredContractViaSdk({
      chainName: ctx.config.network.chainName,
      signer,
      packageHash,
      entryPoint: "issue",
      args,
      rpcUrl: ctx.config.network.rpcUrl,
    });
  } catch (sdkErr) {
    // Fall back to CLI if available
    if (process.env.LIGIS_CASPER_KEY_PATH) {
      try {
        return await callStoredContractViaCli({
          chainName: ctx.config.network.chainName,
          signer,
          packageHash,
          entryPoint: "issue",
          args,
          rpcUrl: ctx.config.network.rpcUrl,
        });
      } catch (cliErr) {
        throw new Error(
          `SDK submission failed: ${sdkErr instanceof Error ? sdkErr.message : sdkErr}\n` +
            `CLI fallback also failed: ${cliErr instanceof Error ? cliErr.message : cliErr}`,
        );
      }
    }
    throw sdkErr;
  }
}

/**
 * Revoke a credential. Calls CredentialRegistry.revoke(subject, capability_hash, nonce, digest, signature).
 * Only the original issuer can revoke.
 */
export async function revokeCredential(
  ctx: CasperClientContext,
  opts: {
    subject: string;
    capability: string;
    nonce: string;
    issuerKey: string;
  },
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const signer = requireSigner();

  if (!opts.issuerKey) {
    throw new Error(
      "revokeCredential: issuerKey is required to sign the revocation",
    );
  }

  const claim = canonicalizeClaim(opts.capability);
  const capHash = claimHash(claim) as `0x${string}`;
  // Pad subject to 32 bytes for consistency with issue/verify.
  const subjectRaw = stripAccountHashPrefix(opts.subject);
  const subjectPadded =
    subjectRaw.length === 64 ? subjectRaw : subjectRaw.padStart(64, "0");
  const subjectBytes = hexToBytes(subjectPadded);
  const capHashBytes = hexToBytes(capHash);

  const message: RevocationMessage = {
    subject: `0x${subjectPadded}`,
    capabilityHash: capHash,
    nonce: opts.nonce,
  };
  const digest = buildRevokeDigest(ctx.config, message);

  const priv = hexToBytes(opts.issuerKey);
  const sig = secp256k1.sign(hexToBytes(digest), priv);
  const compact = sig.toCompactRawBytes();
  const fullSig = new Uint8Array(65);
  fullSig.set(compact, 0);
  fullSig[64] = 27 + (sig.recovery ?? 0);
  const signature = bytesToHex(fullSig);

  const args = new Map<string, CLValueType>();
  args.set("subject", CLValue.newCLByteArray(subjectBytes));
  args.set("claim_hash", CLValue.newCLByteArray(capHashBytes));
  args.set("nonce", CLValue.newCLUint64(BigInt(opts.nonce)));
  args.set("digest", CLValue.newCLByteArray(hexToBytes(digest)));
  args.set("signature", CLValue.newCLByteArray(hexToBytes(signature)));

  // Use SDK-based submission (no casper-client CLI required).
  try {
    return await callStoredContractViaSdk({
      chainName: ctx.config.network.chainName,
      signer,
      packageHash,
      entryPoint: "revoke",
      args,
      rpcUrl: ctx.config.network.rpcUrl,
    });
  } catch (sdkErr) {
    if (process.env.LIGIS_CASPER_DEBUG) {
      console.warn(
        `[ligis-casper] SDK submission failed, trying CLI fallback: ${sdkErr instanceof Error ? sdkErr.message : sdkErr}`,
      );
    }
    if (process.env.LIGIS_CASPER_KEY_PATH) {
      try {
        return await callStoredContractViaCli({
          chainName: ctx.config.network.chainName,
          signer,
          packageHash,
          entryPoint: "revoke",
          args,
          rpcUrl: ctx.config.network.rpcUrl,
        });
      } catch (cliErr) {
        throw new Error(
          `SDK submission failed: ${sdkErr instanceof Error ? sdkErr.message : sdkErr}\n` +
            `CLI fallback also failed: ${cliErr instanceof Error ? cliErr.message : cliErr}`,
        );
      }
    }
    throw sdkErr;
  }
}

// ---------- v2 admin ops ----------

async function callRegistry(
  ctx: CasperClientContext,
  entryPoint: string,
  args: Map<string, CLValueType>,
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const signer = requireSigner();
  try {
    return await callStoredContractViaSdk({
      chainName: ctx.config.network.chainName,
      signer,
      packageHash,
      entryPoint,
      args,
      rpcUrl: ctx.config.network.rpcUrl,
    });
  } catch (sdkErr) {
    if (process.env.LIGIS_CASPER_DEBUG) {
      console.warn(
        `[ligis-casper] SDK submission failed, trying CLI fallback: ${sdkErr instanceof Error ? sdkErr.message : sdkErr}`,
      );
    }
    if (process.env.LIGIS_CASPER_KEY_PATH) {
      try {
        return await callStoredContractViaCli({
          chainName: ctx.config.network.chainName,
          signer,
          packageHash,
          entryPoint,
          args,
          rpcUrl: ctx.config.network.rpcUrl,
        });
      } catch (cliErr) {
        throw new Error(
          `SDK submission failed: ${sdkErr instanceof Error ? sdkErr.message : sdkErr}\n` +
            `CLI fallback also failed: ${cliErr instanceof Error ? cliErr.message : cliErr}`,
        );
      }
    }
    throw sdkErr;
  }
}

/**
 * Set the on-chain EIP-712 domain separator (admin only). Must be called once
 * after deploy — issue() reverts until it is set. Compute with
 * buildDomainSeparator(config) once the package hash is known.
 */
export async function setDomainSeparator(
  ctx: CasperClientContext,
  domainSeparator: `0x${string}`,
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set(
    "domain_separator",
    CLValue.newCLByteArray(hexToBytes(domainSeparator)),
  );
  return callRegistry(ctx, "set_domain_separator", args);
}

/** Enable/disable the accreditation requirement for a claim namespace (admin). */
export async function setNamespacePolicy(
  ctx: CasperClientContext,
  namespace: string,
  accreditationRequired: boolean,
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set(
    "namespace_hash",
    CLValue.newCLByteArray(hexToBytes(namespaceHashOf(namespace))),
  );
  args.set("required", CLValue.newCLValueBool(accreditationRequired));
  return callRegistry(ctx, "set_namespace_policy", args);
}

/** Accredit (or de-accredit) an issuer for a claim namespace (admin). */
export async function setIssuerAccreditation(
  ctx: CasperClientContext,
  issuer: string,
  namespace: string,
  accredited: boolean,
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set("issuer", CLValue.newCLByteArray(hexToBytes(issuer)));
  args.set(
    "namespace_hash",
    CLValue.newCLByteArray(hexToBytes(namespaceHashOf(namespace))),
  );
  args.set("active", CLValue.newCLValueBool(accredited));
  return callRegistry(ctx, "set_issuer_accreditation", args);
}

/** Transfer registry admin to a new Casper native account (admin only). */
export async function setRegistryAdmin(
  ctx: CasperClientContext,
  newAdminAccountHash: string,
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set(
    "new_admin",
    CLValue.newCLByteArray(
      hexToBytes(stripAccountHashPrefix(newAdminAccountHash)),
    ),
  );
  return callRegistry(ctx, "set_admin", args);
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

  const args = new Map<string, CLValueType>();
  args.set("token_id", CLValue.newCLUint64(BigInt(opts.agentId)));
  args.set("uri", CLValue.newCLString(opts.uri));

  return callStoredContractViaCli({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "set_token_uri",
    args,
    rpcUrl: ctx.config.network.rpcUrl,
  });
}

// ---------- balance ----------

/**
 * Query the CSPR balance of a public key.
 * Returns the balance in motes (1 CSPR = 1,000,000,000 motes).
 * Returns { balance: "0", displayBalance: "0 CSPR" } if the account
 * doesn't exist on-chain yet (unfunded).
 */
export async function getBalance(
  ctx: CasperClientContext,
  publicKeyHex: string,
): Promise<{ balance: string; displayBalance: string }> {
  try {
    const pubKey = PublicKey.fromHex(publicKeyHex);
    const purseIdentifier = PurseIdentifier.fromPublicKey(pubKey);
    const result = await ctx.rpc.queryLatestBalance(purseIdentifier);
    const balance = (result as any)?.balance ?? "0";
    const motes = BigInt(balance);
    const cspr = Number(motes) / 1_000_000_000;
    return {
      balance: balance.toString(),
      displayBalance: `${cspr.toFixed(4)} CSPR`,
    };
  } catch {
    // Account doesn't exist on-chain (unfunded) or RPC method unsupported.
    return { balance: "0", displayBalance: "0 CSPR (unfunded)" };
  }
}

// Re-exports for tests / sibling modules
export { capabilityHash };

// ---------- M2: OutcomeFeed (reputation receipts) ----------

async function callContractByDeployment(
  ctx: CasperClientContext,
  which: "outcomeFeed" | "policyGuard",
  entryPoint: string,
  args: Map<string, CLValueType>,
): Promise<{ txHash: string; blockNumber: string }> {
  const packageHash = requireDeployment(ctx, which);
  const signer = requireSigner();
  try {
    return await callStoredContractViaSdk({
      chainName: ctx.config.network.chainName,
      signer,
      packageHash,
      entryPoint,
      args,
      rpcUrl: ctx.config.network.rpcUrl,
    });
  } catch (sdkErr) {
    if (process.env.LIGIS_CASPER_DEBUG) {
      console.warn(
        `[ligis-casper] SDK submission failed, trying CLI fallback: ${sdkErr instanceof Error ? sdkErr.message : sdkErr}`,
      );
    }
    if (process.env.LIGIS_CASPER_KEY_PATH) {
      try {
        return await callStoredContractViaCli({
          chainName: ctx.config.network.chainName,
          signer,
          packageHash,
          entryPoint,
          args,
          rpcUrl: ctx.config.network.rpcUrl,
        });
      } catch (cliErr) {
        throw new Error(
          `SDK submission failed: ${sdkErr instanceof Error ? sdkErr.message : sdkErr}\n` +
            `CLI fallback also failed: ${cliErr instanceof Error ? cliErr.message : cliErr}`,
        );
      }
    }
    throw sdkErr;
  }
}

export const OUTCOME_SETTLED = 0;
export const OUTCOME_DISPUTED = 1;
export const OUTCOME_REJECTED = 2;
export const OUTCOME_OTHER = 3;

/**
 * Anchor an outcome receipt on OutcomeFeed (M2 history axis).
 * `receiptHash` commits to off-chain evidence (payment tx, adjudication
 * verdict, delivery attestation); heavy data stays off-chain.
 */
export async function recordOutcome(
  ctx: CasperClientContext,
  opts: {
    subject: string; // 32-byte account hash hex (with or without prefix)
    claimHash: `0x${string}`; // keccak256(claim) — use claimHash() from @ligis/core
    kind: number; // OUTCOME_*
    receiptHash: `0x${string}`;
  },
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set(
    "subject",
    CLValue.newCLByteArray(hexToBytes(stripAccountHashPrefix(opts.subject))),
  );
  args.set("claim_hash", CLValue.newCLByteArray(hexToBytes(opts.claimHash)));
  args.set("kind", CLValue.newCLUint8(opts.kind));
  args.set(
    "receipt_hash",
    CLValue.newCLByteArray(hexToBytes(opts.receiptHash)),
  );
  return callContractByDeployment(ctx, "outcomeFeed", "record_outcome", args);
}

// ---------- M3: PolicyGuard (enforceable spend/policy checks) ----------

/**
 * Set a subject's spending policy on PolicyGuard (admin only).
 * `requiredClaimHash` zero disables the credential leg.
 * `budget` is in motes per `windowSecs` rolling window.
 */
export async function setPolicyGuardPolicy(
  ctx: CasperClientContext,
  opts: {
    subject: string;
    windowSecs: bigint;
    budget: bigint; // motes
    requiredClaimHash?: `0x${string}`;
    enabled?: boolean;
  },
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set(
    "subject",
    CLValue.newCLByteArray(hexToBytes(stripAccountHashPrefix(opts.subject))),
  );
  args.set("window_secs", CLValue.newCLUint64(opts.windowSecs));
  args.set("budget", CLValue.newCLUInt512(opts.budget));
  args.set(
    "required_claim_hash",
    CLValue.newCLByteArray(
      hexToBytes(opts.requiredClaimHash ?? `0x${"00".repeat(32)}`),
    ),
  );
  args.set("enabled", CLValue.newCLValueBool(opts.enabled ?? true));
  return callContractByDeployment(ctx, "policyGuard", "set_policy", args);
}

/** Transfer PolicyGuard admin (admin only). */
export async function setPolicyGuardAdmin(
  ctx: CasperClientContext,
  newAdminAccountHash: string,
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set(
    "new_admin",
    CLValue.newCLByteArray(
      hexToBytes(stripAccountHashPrefix(newAdminAccountHash)),
    ),
  );
  return callContractByDeployment(ctx, "policyGuard", "set_admin", args);
}

/**
 * Evaluate + record a spend against a subject's policy (M3).
 * Returns the deploy result; the boolean verdict is in the tx effects —
 * callers that need the value should read it via a follow-up query or
 * treat the tx as the enforcement record. Cross-contract callers (e.g.
 * vaults) read the return value on-chain directly.
 */
export async function checkAndRecordSpend(
  ctx: CasperClientContext,
  opts: { subject: string; amount: bigint },
): Promise<{ txHash: string; blockNumber: string }> {
  const args = new Map<string, CLValueType>();
  args.set(
    "subject",
    CLValue.newCLByteArray(hexToBytes(stripAccountHashPrefix(opts.subject))),
  );
  args.set("amount", CLValue.newCLUInt512(opts.amount));
  return callContractByDeployment(ctx, "policyGuard", "check_and_record", args);
}
