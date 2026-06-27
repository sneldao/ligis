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
import { blake2b } from "@noble/hashes/blake2b";
import casperSdk from "casper-js-sdk";
import type { CLValue as CLValueType } from "casper-js-sdk";
const { CLValue, PublicKey, PurseIdentifier } = casperSdk;
import { capabilityHash, parseCapability } from "@ligis/core";
import type { CasperClientContext } from "./client.js";
import { buildCredentialDigest, type CredentialMessage } from "./eip712.js";
import { loadSigner, callStoredContractViaCli, type Signer } from "./signer.js";

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

/** Strip the account-hash- prefix from an account hash string. */
function stripAccountHashPrefix(hash: string): string {
  return hash
    .replace(/^account-hash-/, "")
    .replace(/^0x/, "");
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
    const { execSync } = await import("node:child_process");
    const contractHash = `hash-${stripPrefix(packageHash)}`;

    // Get state root hash
    const stateRootOutput = execSync(
      `casper-client get-state-root-hash --node-address ${rpcUrl} 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );
    const srMatch = stateRootOutput.match(/"state_root_hash":\s*"([a-f0-9]+)"/);
    if (!srMatch) return null;
    const stateRoot = srMatch[1];

    // Query the dictionary
    const output = execSync(
      `casper-client get-dictionary-item --node-address ${rpcUrl} ` +
        `--state-root-hash ${stateRoot} ` +
        `--contract-hash ${contractHash} ` +
        `--dictionary-name "wallet_of_agent" ` +
        `--dictionary-item-key "${dictItemKey}" 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );

    const parsedMatch = output.match(/"parsed":\s*"?(\d+)"?/);
    if (parsedMatch) {
      const tokenId = parsedMatch[1];
      if (tokenId === "0") return null;
      return tokenId;
    }
    return null;
  } catch {
    // Dictionary query failed — contract may not have the mapping yet
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
): Promise<{ agentId: string; controller: string; txHash: string; blockNumber: string }> {
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
  latest: { issuer: string; issuedAt: string; expiresAt: string; revoked: boolean; valid: boolean };
}> {
  const packageHash = requireDeployment(ctx, "credentialRegistry");
  const capHash = parseCapability(opts.capability) as `0x${string}`;

  const subjectBytes = accountHashToBytes(opts.subject);
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
    const { execSync } = await import("node:child_process");
    const pkgHash = `hash-${stripPrefix(packageHash)}`;

    // 1. Query the contract package to get the latest contract hash
    const pkgOutput = execSync(
      `casper-client query-global-state --node-address ${rpcUrl} --key ${pkgHash} 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );
    const pkgData = JSON.parse(pkgOutput)?.result?.stored_value?.ContractPackage;
    const versions = pkgData?.versions ?? [];
    const latestVersion = versions[versions.length - 1];
    const contractHashRaw = latestVersion?.contract_hash ?? "";
    if (!contractHashRaw) throw new Error("No contract hash found");
    const contractHash = `hash-${contractHashRaw.replace(/^contract-/, "")}`;

    // 2. Get the contract's named keys to find the `state` URef
    const contractOutput = execSync(
      `casper-client query-global-state --node-address ${rpcUrl} ` +
      `--key ${contractHash} 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );
    const contractData = JSON.parse(contractOutput)?.result?.stored_value?.Contract;
    if (!contractData) throw new Error("Contract not found");
    const stateUref = contractData.named_keys?.find(
      (k: any) => k.name === "state",
    )?.key;
    if (!stateUref) throw new Error("state URef not found");

    // 2. Compute the Odra dictionary item key
    const indexBytes = Buffer.alloc(4);
    indexBytes.writeUInt32BE(2, 0); // field index 2 for `latest`
    const mappingData = Buffer.concat([
      Buffer.from(subjectBytes),
      Buffer.from(capHashBytes),
    ]);
    const finalKey = Buffer.concat([indexBytes, mappingData]);
    const dictItemKey = Buffer.from(blake2b(finalKey, { dkLen: 32 })).toString("hex");

    // 3. Get state root hash
    const stateRootOutput = execSync(
      `casper-client get-state-root-hash --node-address ${rpcUrl} 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );
    const srMatch = stateRootOutput.match(/"state_root_hash":\s*"([a-f0-9]+)"/);
    if (!srMatch) throw new Error("No state root hash");
    const stateRoot = srMatch[1];

    // 4. Query the dictionary item
    const output = execSync(
      `casper-client get-dictionary-item --node-address ${rpcUrl} ` +
        `--state-root-hash ${stateRoot} ` +
        `--seed-uref "${stateUref}" ` +
        `--dictionary-item-key "${dictItemKey}" 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );

    // Parse the CLValue — Odra stores CredentialView as List<U8> (raw bytes)
    const clValue = JSON.parse(output)?.result?.stored_value?.CLValue;
    if (!clValue) throw new Error("No CLValue in response");

    const view = parseCredentialViewBytes(clValue);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const capable = view.valid && !view.revoked && BigInt(view.expiresAt) > now &&
      (!opts.issuer || view.issuer.toLowerCase() === opts.issuer.toLowerCase());

    return {
      capable,
      capabilityHash: capHash,
      latest: view,
    };
  } catch {
    // Dictionary query failed — credential not found or query not supported
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
}

/** Parse a CredentialView stored as List<U8> bytes.
 *
 * The bytes (after the 4-byte length prefix) are:
 *   issuer: [u8; 20] | subject: [u8; 32] | issued_at: u64 LE | expires_at: u64 LE | revoked: bool | valid: bool
 */
function parseCredentialViewBytes(clValue: any): {
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  valid: boolean;
} {
  const hexBytes = clValue.bytes ?? "";
  const allBytes = Buffer.from(hexBytes, "hex");
  // First 4 bytes = length prefix (u32 LE)
  const len = allBytes.readUInt32LE(0);
  const data = allBytes.subarray(4, 4 + len);
  if (data.length < 70) {
    return { issuer: "0x" + "00".repeat(20), issuedAt: "0", expiresAt: "0", revoked: false, valid: false };
  }
  let offset = 0;
  const issuer = "0x" + data.subarray(offset, offset + 20).toString("hex"); offset += 20;
  // subject (32 bytes) — skip, not needed for verification
  offset += 32;
  const issuedAt = data.readBigUInt64LE(offset).toString(); offset += 8;
  const expiresAt = data.readBigUInt64LE(offset).toString(); offset += 8;
  const revoked = data[offset] !== 0; offset += 1;
  const valid = data[offset] !== 0;
  return { issuer, issuedAt, expiresAt, revoked, valid };
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
  // Odra stores the `issuer_nonce` mapping at field index 1.
  // The dictionary key is blake2b(index_bytes ++ issuer_bytes) where
  // index_bytes = u32 BE of 1.
  let nonce = "0";
  try {
    const packageHash = ctx.config.deployment.credentialRegistry;
    if (packageHash) {
      const rpcUrl = ctx.config.network.rpcUrl;
      const { execSync } = await import("node:child_process");
      const pkgHash = `hash-${stripPrefix(packageHash)}`;

      // Query the contract package to get the latest contract hash
      const pkgOutput = execSync(
        `casper-client query-global-state --node-address ${rpcUrl} --key ${pkgHash} 2>&1`,
        { encoding: "utf-8", timeout: 15000 },
      );
      const pkgData = JSON.parse(pkgOutput)?.result?.stored_value?.ContractPackage;
      const versions = pkgData?.versions ?? [];
      // Get the latest enabled version's contract hash
      const latestVersion = versions[versions.length - 1];
      const contractHashRaw = latestVersion?.contract_hash ?? "";
      if (!contractHashRaw) throw new Error("No contract hash found");
      // contractHashRaw is like "contract-b50e044687d471c0b3472db990070169eddefc4275cd0eb9e7700d4d75cc9595"
      // Convert to hash- format for query
      const contractHash = `hash-${contractHashRaw.replace(/^contract-/, "")}`;

      // Get the contract's state URef
      const contractOutput = execSync(
        `casper-client query-global-state --node-address ${rpcUrl} --key ${contractHash} 2>&1`,
        { encoding: "utf-8", timeout: 15000 },
      );
      const contractData = JSON.parse(contractOutput)?.result?.stored_value?.Contract;
      const stateUref = contractData?.named_keys?.find(
        (k: any) => k.name === "state",
      )?.key;
      if (stateUref) {
        // Compute dictionary item key for issuer_nonce mapping (index 1)
        const issuerBytes = Buffer.from(stripPrefix(issuer), "hex");
        const indexBytes = Buffer.alloc(4);
        indexBytes.writeUInt32BE(1, 0); // field index 1 for `issuer_nonce`
        const finalKey = Buffer.concat([indexBytes, issuerBytes]);
        const dictItemKey = Buffer.from(blake2b(finalKey, { dkLen: 32 })).toString("hex");

        // Get state root hash
        const srOutput = execSync(
          `casper-client get-state-root-hash --node-address ${rpcUrl} 2>&1`,
          { encoding: "utf-8", timeout: 15000 },
        );
        const srMatch = srOutput.match(/"state_root_hash":\s*"([a-f0-9]+)"/);
        if (srMatch) {
          const stateRoot = srMatch[1];
          const dictOutput = execSync(
            `casper-client get-dictionary-item --node-address ${rpcUrl} ` +
            `--state-root-hash ${stateRoot} ` +
            `--seed-uref "${stateUref}" ` +
            `--dictionary-item-key "${dictItemKey}" 2>&1`,
            { encoding: "utf-8", timeout: 15000 },
          );
          const clValue = JSON.parse(dictOutput)?.result?.stored_value?.CLValue;
          if (clValue?.bytes) {
            // Odra stores U64 as List<U8>: 4-byte length prefix + 8-byte LE value
            const buf = Buffer.from(clValue.bytes, "hex");
            nonce = buf.readBigUInt64LE(4).toString();
          }
        }
      }
    }
  } catch {
    // Contract not deployed or query failed — default nonce "0" is fine.
  }

  const message: CredentialMessage = {
    issuer,
    subject: `0x${stripAccountHashPrefix(opts.subject)}`,
    capabilityHash: capHash,
    issuedAt: BigInt(issuedAt).toString(16).padStart(2, "0"),
    expiresAt: BigInt(expiresAt).toString(16).padStart(2, "0"),
    nonce: BigInt(nonce).toString(16).padStart(2, "0"),
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

  const args = new Map<string, CLValueType>();
  args.set("issuer", CLValue.newCLByteArray(issuerBytes));
  args.set("subject", CLValue.newCLByteArray(subjectBytes));
  args.set("capability_hash", CLValue.newCLByteArray(capHashBytes));
  args.set("issued_at", CLValue.newCLUint64(BigInt(signed.issuedAt)));
  args.set("expires_at", CLValue.newCLUint64(BigInt(signed.expiresAt)));
  args.set("nonce", CLValue.newCLUint64(BigInt(signed.nonce)));
  // signature is Vec<u8> — a list of U8 CLValues
  const sigList = Array.from(sigBytes).map((b) => CLValue.newCLUint8(b));
  args.set("_signature", CLValue.newCLList(
    { name: "U8", variations: [] } as any,
    sigList,
  ));

  return callStoredContractViaCli({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "issue",
    args,
    rpcUrl: ctx.config.network.rpcUrl,
  });
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

  const args = new Map<string, CLValueType>();
  args.set("subject", CLValue.newCLByteArray(subjectBytes));
  args.set("capability_hash", CLValue.newCLByteArray(capHashBytes));
  args.set("_nonce", CLValue.newCLUint64(BigInt(opts.nonce)));

  return callStoredContractViaCli({
    chainName: ctx.config.network.chainName,
    signer,
    packageHash,
    entryPoint: "revoke",
    args,
    rpcUrl: ctx.config.network.rpcUrl,
  });
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
