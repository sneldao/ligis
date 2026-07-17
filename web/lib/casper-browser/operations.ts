/**
 * Browser-safe mirror of @ligis/adapter-casper operations.
 *
 * The Node adapter shells out to the `casper-client` Rust CLI for every
 * state query; that path craps out in webpack/turbopack browser
 * bundles. This file re-implements the same operations against the
 * Casper JSON-RPC directly — the same wire protocol — so the browser
 * wallet flow can mint identities, verify credentials, and sign+submit
 * without any server-side custodian.
 *
 * Things kept identical to the Node adapter:
 *   - Odra storage scheme (index_bytes ++ mapping_data, blake2b dict key)
 *   - Field indices: AgentId.wallet_of_agent, CredentialRegistry.latest=2, .issuer_nonce=1
 *   - EIP-712 message + Casper domain layout
 *   - secp256k1 issuer recovery on the wire
 *
 * Things that differ:
 *   - State reads use RpcClient via /api/casper-rpc instead of casper-client CLI.
 *   - Writes use `account_put_transaction` JSON-RPC, bypassing the
 *     casper-client CLI entirely.
 */
import * as casperSdk from "casper-js-sdk";
import { blake2b } from "@noble/hashes/blake2b";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  getBalanceMotes,
  getLatestBlockInfo,
  getStateRootHash,
  putTransaction,
  rpcCall,
  waitForDeploy,
} from "./rpc";
import { evmAddressFromSecpKey, generateKeyPair, type CasperKeyPair } from "./keypair";
import {
  buildCredentialDomain,
  signCredentialMessage,
  signDigest,
  type CasperEip712Domain,
  type CredentialMessage,
} from "./eip712";

const {
  Args,
  CLValue,
  Duration,
  Hash,
  InitiatorAddr,
  KeyAlgorithm,
  PrivateKey,
  PublicKey,
  Timestamp,
  Transaction,
  TransactionV1,
  TransactionV1Payload,
  TransactionEntryPoint,
  TransactionEntryPointEnum,
  TransactionRuntime,
  SessionTarget,
  StoredTarget,
  TransactionInvocationTarget,
  ByPackageHashInvocationTarget,
  TransactionTarget,
  PricingMode,
  PaymentLimitedMode,
  TransactionScheduling,
} = casperSdk;

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PAYMENT_AMOUNT = 10_000_000_000; // 10 CSPR

export interface CasperOpEnv {
  rpcUrl: string; // upstream Casper Testnet RPC, used for display only
  chainName: string; // "casper-test"
  agentIdPackageHash: string | null; // hex of AgentId package hash, no "contract-package-" prefix
  credentialRegistryPackageHash: string | null; // hex of registry, no prefix
}

export interface CapabilityRef {
  name: string;
  hash: `0x${string}`;
}

export interface VerifyResult {
  capable: boolean;
  capabilityHash: `0x${string}`;
  latest: {
    issuer: string;
    issuedAt: string;
    expiresAt: string;
    revoked: boolean;
    valid: boolean;
  };
}

export interface SubmitCredentialResult {
  txHash: string;
  blockHeight: string;
}

export interface SignedCredential {
  issuer: `0x${string}`;
  subject: string;
  capabilityHash: `0x${string}`;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  digest: `0x${string}`;
  signature: `0x${string}`;
}

// ---------- helpers ----------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let h = "0x";
  for (const b of bytes) h += b.toString(16).padStart(2, "0");
  return h as `0x${string}`;
}

function hexToBytes32NoPrefix(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return hexToBytes(padLeft(clean, 64));
}

function padLeft(hex: string, width: number): string {
  if (hex.length >= width) return hex;
  return "0".repeat(width - hex.length) + hex;
}

function stripAccountHashPrefix(hash: string): string {
  return hash.replace(/^account-hash-/, "").replace(/^0x/, "");
}

function stripPackagePrefix(hash: string): string {
  return hash.replace(/^contract-package-/, "").replace(/^hash-/, "").replace(/^0x/, "");
}

function requirePackage(env: CasperOpEnv, which: "agentId" | "credentialRegistry"): string {
  const v = which === "agentId" ? env.agentIdPackageHash : env.credentialRegistryPackageHash;
  if (!v) {
    throw new Error(
      `Cas browser: ${which} contract not configured. Set NEXT_PUBLIC_LIGIS_CASPER_${which.toUpperCase() === "AGENTID" ? "AGENT_ID" : "CREDENTIAL_REGISTRY"}.`,
    );
  }
  return stripPackagePrefix(v);
}

function pkgBytes(pkgHash: string): Uint8Array {
  return hexToBytes(pkgHash.replace(/^0x/, "").replace(/^contract-package-/, "").replace(/^hash-/, "").padEnd(64, "0").slice(-64));
}

// Vector matching `capabilityHash` in @ligis/core.
function keccak256OfText(text: string): `0x${string}` {
  const data = new TextEncoder().encode(text);
  return bytesToHex(keccak_256(data));
}

// ---------- state queries (byte 1 of the read protocol) ----------

interface GetDictionaryResp {
  result?: { stored_value?: { CLValue?: { bytes?: string; parsed?: unknown } } };
}

async function getDictionaryItem(
  stateRoot: string,
  dictionaryItemKeyHex: string,
  seedUref: string,
): Promise<unknown> {
  const r = (await rpcCall("state_get_dictionary_item", [
    {
      state_root_hash: stateRoot,
      seed_uref: seedUref,
      dictionary_item_key: dictionaryItemKeyHex,
    },
  ])) as GetDictionaryResp;
  return r?.result?.stored_value?.CLValue;
}

/**
 * Resolve the contract's `state` named-key uref and the active
 * ContractVersion's contract hash for a given package hash.
 *
 * Returns null if not found — the caller treats that as "no data".
 */
async function resolveState(
  env: CasperOpEnv,
  pkgHashBytes: Uint8Array,
): Promise<{ contractHashHex: string; stateUref: string } | null> {
  const pkgAddr = bytesToHex(pkgHashBytes);
  // 1) Find the active contract version inside the ContractPackage.
  const globalState = (await rpcCall("query_global_state", [
    { key: pkgAddr, path: [] },
  ])) as {
    result?: {
      stored_value?: { ContractPackage?: { versions?: Array<{ contract_hash?: string; protocol_version?: string }> } };
    };
  };
  const pkg = globalState?.result?.stored_value?.ContractPackage;
  if (!pkg?.versions?.length) return null;
  const active =
    pkg.versions.find((v) => v.protocol_version === "2.0.0") ??
    pkg.versions[pkg.versions.length - 1]!;
  const contractHashHex = stripPackagePrefix(active.contract_hash ?? "");
  if (!contractHashHex) return null;

  // 2) Read the Contract's named_keys for the `state` uref.
  const contractState = (await rpcCall("query_global_state", [
    {
      key: `hash-${contractHashHex.replace(/^0x/, "")}`,
      path: [],
    },
  ])) as {
    result?: { stored_value?: { Contract?: { named_keys?: Array<{ name: string; key: string }> } } };
  };
  const namedKeys = contractState?.result?.stored_value?.Contract?.named_keys ?? [];
  const stateEntry = namedKeys.find((k) => k.name === "state");
  if (!stateEntry) return null;
  return { contractHashHex, stateUref: stateEntry.key };
  void env; // reserved for future non-testnet mainnets
}

// ---------- agent-id reads ----------

/**
 * Read the AgentId token_id for a controller (public key hex).
 *
 * Returns "0" if no agent minted — the caller treats that as "not found".
 */
export async function getAgentIdFromController(
  env: CasperOpEnv,
  controllerPublicKeyHex: string,
): Promise<string> {
  if (!env.agentIdPackageHash) return "0";
  const pkgHash = requirePackage(env, "agentId");
  const pkgBytesArr = hexToBytes(pkgHash);
  const resolved = await resolveState(env, pkgBytesArr);
  if (!resolved) return "0";
  const { stateUref } = resolved;

  // Convert the controller public key to its 32-byte account hash bytes,
  // matching how Odra indexes `wallet_of_agent`.
  const pubKey = PublicKey.fromHex(controllerPublicKeyHex);
  const acctHashBytes = pubKey.accountHash().toBytes();
  const dictItemKey = bytesToHex(blake2b(acctHashBytes, { dkLen: 32 }));
  const stateRoot = await getStateRootHash();
  const cl = await getDictionaryItem(stateRoot, stripAccountHashPrefix(dictItemKey), stateUref);
  if (!cl) return "0";
  const parsed = (cl as { parsed?: unknown }).parsed;
  if (typeof parsed === "string" && parsed !== "0") return parsed;
  // Fallback: parse length-prefixed uint64 from raw bytes.
  const bytesHex = (cl as { bytes?: string }).bytes ?? "";
  if (!bytesHex) return "0";
  const buf = new Uint8Array(bytesHex.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(bytesHex.slice(i * 2, i * 2 + 2), 16);
  }
  if (buf.length < 12) return "0";
  const dv = new DataView(buf.buffer, buf.byteOffset + 4, 8); // skip 4-byte length prefix
  const lo = dv.getUint32(0, true);
  const hi = dv.getUint32(4, true);
  return `${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}`;
}

// Resolver for `account_hash` -> `0x` bytes32 used in EIP-712 subject.
function AccountHash_Bytes(accountHash: string): Uint8Array {
  return hexToBytes(stripAccountHashPrefix(accountHash).padStart(64, "0"));
}

// ---------- credential reads ----------

/**
 * Verify whether a subject (account hash) holds a valid (non-revoked,
 * non-expired) capability credential on the CredentialRegistry.
 */
export async function verifyCapability(
  env: CasperOpEnv,
  opts: { subject: string; capability: CapabilityRef | string; issuer?: string },
): Promise<VerifyResult> {
  const cap =
    typeof opts.capability === "string"
      ? { name: opts.capability, hash: keccak256OfText(opts.capability) as `0x${string}` }
      : opts.capability;
  if (!env.credentialRegistryPackageHash) {
    return emptyVerify(cap.hash);
  }
  const pkgHash = requirePackage(env, "credentialRegistry");
  const resolved = await resolveState(env, hexToBytes(pkgHash));
  if (!resolved) return emptyVerify(cap.hash);

  // Odra indexes `latest` (field index 2) by blake2b(0x00000002 || subject || cap_hash).
  const subjectBytes = hexToBytes32NoPrefix(opts.subject);
  const capHashBytes = hexToBytes(cap.hash.replace(/^0x/, ""));
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, 2, false); // BE
  const concat = new Uint8Array(4 + 32 + 32);
  concat.set(indexBytes, 0);
  concat.set(subjectBytes, 4);
  concat.set(capHashBytes, 36);
  const dictItemKey = bytesToHex(blake2b(concat, { dkLen: 32 })).slice(2);
  const stateRoot = await getStateRootHash();
  const cl = await getDictionaryItem(stateRoot, dictItemKey, resolved.stateUref);
  if (!cl) return emptyVerify(cap.hash);
  const view = parseCredentialView(cl);
  if (!view) return emptyVerify(cap.hash);

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const capable =
    view.valid &&
    !view.revoked &&
    BigInt(view.expiresAt) > nowSec &&
    (!opts.issuer || view.issuer.toLowerCase() === opts.issuer.toLowerCase());

  return { capable, capabilityHash: cap.hash, latest: view };
}

function emptyVerify(hash: `0x${string}`): VerifyResult {
  return {
    capable: false,
    capabilityHash: hash,
    latest: {
      issuer: "0x" + "00".repeat(20),
      issuedAt: "0",
      expiresAt: "0",
      revoked: false,
      valid: false,
    },
  };
}

function parseCredentialView(cl: unknown): VerifyResult["latest"] | null {
  const bytesHex = (cl as { bytes?: string }).bytes;
  if (typeof bytesHex !== "string" || bytesHex.length === 0) return null;
  const buf = new Uint8Array(bytesHex.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(bytesHex.slice(i * 2, i * 2 + 2), 16);
  }
  // Layout (after a 4-byte u32 LE length prefix): issuer(20) || subject(32) ||
  // issued_at(u64 LE) || expires_at(u64 LE) || revoked(bool) || valid(bool)
  if (buf.length < 4 + 20 + 32 + 8 + 8 + 1 + 1) return null;
  let o = 4;
  const issuer =
    "0x" +
    Array.from(buf.slice(o, o + 20))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  o += 20 + 32; // subject (32 bytes) skipped
  const dv = new DataView(buf.buffer, buf.byteOffset + o, 8);
  const issuedAtLo = BigInt(dv.getUint32(0, true));
  const issuedAtHi = BigInt(dv.getUint32(4, true) >>> 0);
  const issuedAt = (issuedAtHi * 0x1_0000_0000n + issuedAtLo).toString();
  o += 8;
  const dv2 = new DataView(buf.buffer, buf.byteOffset + o, 8);
  const expiresAtLo = BigInt(dv2.getUint32(0, true));
  const expiresAtHi = BigInt(dv2.getUint32(4, true) >>> 0);
  const expiresAt = (expiresAtHi * 0x1_0000_0000n + expiresAtLo).toString();
  o += 8;
  const revoked = buf[o] !== 0;
  const valid = buf[o + 1] !== 0;
  return { issuer, issuedAt, expiresAt, revoked, valid };
}

// ---------- nonce read ----------

async function readIssuerNonce(
  env: CasperOpEnv,
  issuerEvmAddress: `0x${string}`,
): Promise<bigint> {
  if (!env.credentialRegistryPackageHash) return 0n;
  const pkgHash = requirePackage(env, "credentialRegistry");
  const resolved = await resolveState(env, hexToBytes(pkgHash));
  if (!resolved) return 0n;
  const issuerBytes = hexToBytes32NoPrefix(issuerEvmAddress); // 20 bytes zero-padded to 32
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, 1, false); // BE
  const concat = new Uint8Array(4 + 32);
  concat.set(indexBytes, 0);
  concat.set(issuerBytes, 4);
  const dictItemKey = bytesToHex(blake2b(concat, { dkLen: 32 })).slice(2);
  const stateRoot = await getStateRootHash();
  try {
    const cl = await getDictionaryItem(stateRoot, dictItemKey, resolved.stateUref);
    if (!cl) return 0n;
    const bytesHex = (cl as { bytes?: string }).bytes ?? "";
    if (!bytesHex) return 0n;
    const buf = new Uint8Array(bytesHex.length / 2);
    for (let i = 0; i < buf.length; i++) {
      buf[i] = parseInt(bytesHex.slice(i * 2, i * 2 + 2), 16);
    }
    if (buf.length < 12) return 0n;
    const dv = new DataView(buf.buffer, buf.byteOffset + 4, 8);
    const lo = dv.getUint32(0, true);
    const hi = dv.getUint32(4, true);
    return BigInt(hi) * 0x1_0000_0000n + BigInt(lo);
  } catch {
    return 0n;
  }
}

// ---------- credential message + submission ----------

/**
 * Build + sign an EIP-712 credential. The browser holds the user's
 * private key, so the signature is local. Nonce read from chain.
 */
export async function buildCredentialMessage(
  env: CasperOpEnv,
  opts: {
    issuerPrivateKeyHex: string;
    subject: string;
    capability: CapabilityRef | string;
    expiresInSeconds?: number;
  },
): Promise<SignedCredential> {
  const cap =
    typeof opts.capability === "string"
      ? { name: opts.capability, hash: keccak256OfText(opts.capability) as `0x${string}` }
      : opts.capability;
  const issuer = evmAddressFromSecpKey(opts.issuerPrivateKeyHex);
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresIn = BigInt(opts.expiresInSeconds ?? 30 * 24 * 60 * 60);
  const expiresAt = issuedAt + expiresIn;

  const domain = buildCredentialDomain({
    contractPackageHashHex: requirePackage(env, "credentialRegistry"),
    chainName: env.chainName,
  });
  const subjectBytes32 = bytesToHex(AccountHash_Bytes(opts.subject));
  const nonce = await readIssuerNonce(env, issuer);

  const message: CredentialMessage = {
    issuer,
    subject: subjectBytes32,
    capabilityHash: cap.hash,
    issuedAt: issuedAt.toString(),
    expiresAt: expiresAt.toString(),
    nonce: nonce.toString(),
  };
  const { digest, signature } = signCredentialMessage({
    domain,
    issuerPrivateKeyHex: opts.issuerPrivateKeyHex,
    message,
  });

  return {
    issuer: issuer as `0x${string}`,
    subject: opts.subject,
    capabilityHash: cap.hash,
    issuedAt: issuedAt.toString(),
    expiresAt: expiresAt.toString(),
    nonce: nonce.toString(),
    digest,
    signature,
  };
}

/** Submit a signed credential to CredentialRegistry.issue on chain. */
export async function submitCredential(
  env: CasperOpEnv,
  signed: SignedCredential,
  signer: CasperKeyPair,
): Promise<SubmitCredentialResult> {
  const pkgHash = requirePackage(env, "credentialRegistry");
  const args = new Map<string, ReturnType<typeof CLValue.newCLByteArray>>();
  args.set("issuer", CLValue.newCLByteArray(hexToBytes(signed.issuer)));
  args.set("subject", CLValue.newCLByteArray(hexToBytes(stripAccountHashPrefix(signed.subject))));
  args.set("capability_hash", CLValue.newCLByteArray(hexToBytes(signed.capabilityHash)));
  args.set("issued_at", CLValue.newCLUint64(BigInt(signed.issuedAt)));
  args.set("expires_at", CLValue.newCLUint64(BigInt(signed.expiresAt)));
  args.set("nonce", CLValue.newCLUint64(BigInt(signed.nonce)));
  args.set("digest", CLValue.newCLByteArray(hexToBytes(signed.digest)));
  args.set("signature", CLValue.newCLByteArray(hexToBytes(signed.signature)));

  const txHash = await callStoredContract({
    env,
    signer,
    packageHashHex: pkgHash,
    entryPoint: "issue",
    args,
    paymentAmount: 5_000_000_000, // 5 CSPR
  });
  const { blockHeight } = await waitForDeploy(txHash, { timeoutMs: 180_000 });
  return { txHash, blockHeight };
}

// ---------- mint agent id ----------

/**
 * Mint a new AgentId for the connected wallet. Calls AgentId.mint_self.
 * Funds the call from the connected wallet — supports user-funded flow.
 */
export async function mintSelf(
  env: CasperOpEnv,
  signer: CasperKeyPair,
  tokenUriHex: string = "",
): Promise<{ txHash: string; blockHeight: string; tokenId: string }> {
  const pkgHash = requirePackage(env, "agentId");
  const args = new Map<string, ReturnType<typeof CLValue.newCLString>>();
  args.set("token_uri", CLValue.newCLString(tokenUriHex));
  const txHash = await callStoredContract({
    env,
    signer,
    packageHashHex: pkgHash,
    entryPoint: "mint_self",
    args,
    paymentAmount: 5_000_000_000,
  });
  const { blockHeight } = await waitForDeploy(txHash, { timeoutMs: 180_000 });
  const tokenId = await getAgentIdFromController(env, signer.publicKeyHex);
  return { txHash, blockHeight, tokenId: tokenId || "1" };
}

/**
 * Anchor an evidence URI to an AgentId. Calls AgentId.set_token_uri.
 */
export async function anchorEvidence(
  env: CasperOpEnv,
  signer: CasperKeyPair,
  opts: { tokenId: string; uri: string },
): Promise<{ txHash: string; blockHeight: string }> {
  const pkgHash = requirePackage(env, "agentId");
  const args = new Map<string, ReturnType<typeof CLValue.newCLUint64>>();
  args.set("token_id", CLValue.newCLUint64(BigInt(opts.tokenId)));
  // The contract expects a string uri; reuse newCLString and reset the map type below.
  (args as unknown as Map<string, ReturnType<typeof CLValue.newCLString>>).set(
    "uri",
    CLValue.newCLString(opts.uri),
  );
  const txHash = await callStoredContract({
    env,
    signer,
    packageHashHex: pkgHash,
    entryPoint: "set_token_uri",
    args: args as unknown as Map<string, ReturnType<typeof CLValue.newCLByteArray>>,
    paymentAmount: 3_000_000_000,
  });
  const { blockHeight } = await waitForDeploy(txHash, { timeoutMs: 180_000 });
  return { txHash, blockHeight };
}

// ---------- internal: build + sign + submit TransactionV1 ----------

interface CallContractOpts {
  env: CasperOpEnv;
  signer: CasperKeyPair;
  packageHashHex: string;
  entryPoint: string;
  args: Map<string, ReturnType<typeof CLValue.newCLByteArray>>;
  paymentAmount?: number;
}

/**
 * Build a TransactionV1 that invokes a stored contract entry-point,
 * sign it with the user's private key, and submit it through the proxy.
 *
 * The casper-js-sdk 5.x API exposes the args to TransactionV1Payload.build
 * and to ByPackageHashInvocationTarget as a `Map<string, CLValue>` (or a
 * `RuntimeArgs` derived from such a map). Older code wrapped this in
 * `new Args(map)`; in 5.x that constructor takes no positional argument,
 * so we just pass the typed map through.
 */
async function callStoredContract(opts: CallContractOpts): Promise<string> {
  const pkgBytesArr = hexToBytes(opts.packageHashHex.replace(/^0x/, ""));
  // `CLValue` is a class — use InstanceType<typeof CLValue> as the
  // structural type for the values map. Casper-js-sdk 5.0.12 accepts a
  // `Map<string, CLValue>` and `Args` wraps it via `new Args(map)`.
  type CLValueInstance = InstanceType<typeof CLValue>;
  const argsMap = opts.args as unknown as Map<string, CLValueInstance>;

  const pk = PrivateKey.fromHex(opts.signer.privateKeyHex.replace(/^0x/, ""), KeyAlgorithm.SECP256K1);
  const publicKey = pk.publicKey;
  const initiatorAddr = new InitiatorAddr(publicKey);

  const ttl = new Duration(DEFAULT_TTL_MS);
  const timestamp = new Timestamp(new Date());
  // Casper 2.0 TransactionV1 entry-point dispatch: stored contracts
  // invoked via ByPackageHash need the actual entry-point NAME carried
  // on the wire as a `Custom` entry-point. `TransactionEntryPointEnum.Call`
  // would serialize *only* the enum tag (the chain's default `call`),
  // so a deploy hitting `mint_self` would never reach that method.
  // Use Custom + opts.entryPoint per the SDK's documented path.
  const entryPointFlag = new TransactionEntryPoint(
    TransactionEntryPointEnum.Custom,
    opts.entryPoint,
  );

  // casper-js-sdk 5.0.12 ByPackageHashInvocationTarget: no ctor params;
  // set addr + protocolVersionMajor directly. Then wrap in
  // TransactionInvocationTarget.byPackageHash → StoredTarget → TransactionTarget.
  // Hash.fromBytes returns an IResultWithBytes<Hash>, so we route
  // through Hash.fromHex to keep the .addr field as a plain Hash.
  const byHash = new ByPackageHashInvocationTarget();
  byHash.addr = Hash.fromHex(bytesToHex(pkgBytesArr).replace(/^0x/, ""));
  byHash.protocolVersionMajor = 2;
  const invocationTarget = new TransactionInvocationTarget();
  invocationTarget.byPackageHash = byHash;
  // casper-js-sdk 5.0.12 StoredTarget: no-arg ctor; set fields directly.
  const storedTarget = new StoredTarget();
  storedTarget.id = invocationTarget;
  storedTarget.runtime = TransactionRuntime.vmCasperV2();
  const txTarget = new TransactionTarget(undefined, storedTarget);

  const pricingMode = new PricingMode();
  pricingMode.paymentLimited = new PaymentLimitedMode();
  pricingMode.paymentLimited.gasPriceTolerance = 1;
  pricingMode.paymentLimited.paymentAmount = opts.paymentAmount ?? DEFAULT_PAYMENT_AMOUNT;
  pricingMode.paymentLimited.standardPayment = false;

  const scheduling = new TransactionScheduling();
  scheduling.standard = {};

  const argsInstance = new Args(argsMap as unknown as Map<string, CLValueInstance>);
  // Defense-in-depth: trip before signing if the SDK silently dropped
  // our entry-point name. Custom=tag 1; Call=tag 0. Anything else
  // means we shipped a broken payload.
  assertEntryPointIsNamed(entryPointFlag, opts.entryPoint);
  const payload = TransactionV1Payload.build({
    initiatorAddr,
    args: argsInstance,
    ttl,
    entryPoint: entryPointFlag,
    pricingMode,
    timestamp,
    transactionTarget: txTarget,
    scheduling,
    chainName: opts.env.chainName,
  });

  const v1 = TransactionV1.makeTransactionV1(payload);
  v1.sign(pk);
  const tx = Transaction.fromTransactionV1(v1);
  // Casper 2.0 RPC expects the transaction bytes wrapped per
  // account_put_transaction. Use the SDK's serializer via a fallback
  // to a JSON shape if the SDK doesn't expose a generic toBytes().
  const txBytes = toJsonBytes(tx);
  const submit = await putTransaction(txBytes);
  return submit.transactionHash;
}

function toJsonBytes(tx: unknown): unknown {
  // The Casper 2.0 RPC submission wrapper expects either raw bytes or
  // a structured `Transaction` object. The `casper-js-sdk` v5 toJSON-like
  // output is the structured form.
  // We attempt (toJSON if present) -> (toBytes as last resort).
  const anyTx = tx as { toJSON?: () => unknown; toBytes?: () => Uint8Array };
  if (typeof anyTx.toJSON === "function") {
    return anyTx.toJSON();
  }
  if (typeof anyTx.toBytes === "function") {
    return "0x" + Array.from(anyTx.toBytes()).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Browser: Transaction object exposes neither toJSON nor toBytes");
}

/**
 * Confirm the transaction entry-point encodes the named method (not just
 * the enum tag). Casper-js-sdk 5.0.12 silently allows `Call` (tag 0) +
 * no name, which the chain interprets as the default `call` method —
 * any named dispatch (`mint_self`/`issue`/`set_token_uri`) would fail
 * with `NoSuchMethod`. Trip if we accidentally re-encoded with `Call`.
 */
function assertEntryPointIsNamed(
  ep: InstanceType<typeof TransactionEntryPoint>,
  expectedName: string,
): void {
  if (ep.type !== TransactionEntryPointEnum.Custom) {
    throw new Error(
      `Browser wallet: entry-point wasn't encoded as Custom. type=${String(ep.type)}; expected Custom("${expectedName}"). This would fail on testnet as NoSuchMethod.`,
    );
  }
  if (ep.customEntryPoint !== expectedName) {
    throw new Error(
      `Browser wallet: entry-point name mismatch. expected="${expectedName}", got="${String(ep.customEntryPoint)}".`,
    );
  }
  const wire = ep.toBytes();
  if (wire.length <= 2) {
    throw new Error(
      `Browser wallet: entry-point serialization is suspiciously short (${wire.length} bytes): ${bytesToHex(wire)}`,
    );
  }
}

// ---------- new wallet generators ----------

export { generateKeyPair };
