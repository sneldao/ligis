import "server-only";
import { createHash } from "node:crypto";
import {
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  http,
  keccak256,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { capabilityHash } from "@ligis/core";
import { getEvmReadContext } from "./chain";
import networks from "../../assets/networks.json";

/**
 * Passkey ceremony relay for Monad testnet.
 *
 * The PasskeyIssuer contract is an ERC-1271 issuer: the registry calls
 * `isValidSignature` on it, which verifies a WebAuthn assertion through the
 * P256 precompile at 0x0100. The browser performs the ceremony
 * (navigator.credentials) — this module only computes digests and relays the
 * resulting calldata. The steward key pays gas; it never authorizes anything.
 */

const NETWORK = "monad-testnet";
const RP_ID = process.env.LIGIS_PASSKEY_RP_ID ?? "ligis.vercel.app";

type MonadDeployment = {
  credentialRegistry: string;
  passkeyIssuer?: string;
};

const monadDeployment = (
  networks as { deployment: Record<string, MonadDeployment> }
).deployment[NETWORK];
const REGISTRY = monadDeployment.credentialRegistry as Address;
const PASSKEY_ISSUER = monadDeployment.passkeyIssuer as Address;

const REGISTRY_ABI = [
  parseAbiItem(
    "function hashTypedData(address issuer, address subject, bytes32 capabilityHash, uint256 issuedAt, uint256 expiresAt, uint256 nonce) view returns (bytes32)",
  ),
  parseAbiItem(
    "function issue(address issuer, address subject, bytes32 capabilityHash, uint64 issuedAt, uint64 expiresAt, uint256 nonce, bytes signature) returns (uint256)",
  ),
  parseAbiItem(
    "function isCapable(address subject, bytes32 capabilityHash) view returns (bool)",
  ),
  parseAbiItem("function issuerNonce(address issuer) view returns (uint256)"),
];

const ISSUER_ABI = [
  parseAbiItem(
    "function registerPasskey(bytes32 keyId, uint256 qx, uint256 qy)",
  ),
  parseAbiItem(
    "function revokeCredential(address registry, address subject, bytes32 capabilityHash, uint256 nonce, bytes32 keyId, bytes authenticatorData, bytes clientDataJSON, uint256 r, uint256 s)",
  ),
  parseAbiItem(
    "function passkeys(bytes32) view returns (uint256 qx, uint256 qy)",
  ),
  parseAbiItem("function rpIdHash() view returns (bytes32)"),
];

function relayAccount() {
  const raw =
    process.env.LIGIS_STEWARD_KEY ||
    process.env.PRIVATE_KEY ||
    process.env.PHAROS_DEPLOYER_KEY;
  if (!raw) return null;
  return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
}

/**
 * Sign + broadcast a write via sendRawTransaction (same pattern as
 * web/lib/steward.ts — some RPCs reject eth_sendTransaction).
 */
async function relay(params: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}): Promise<Hex> {
  const ctx = getEvmReadContext(NETWORK);
  const account = relayAccount();
  if (!account) {
    throw new Error(
      "No relay key configured (LIGIS_STEWARD_KEY) — reads only.",
    );
  }
  const wallet = createWalletClient({
    account,
    chain: ctx.chain,
    transport: http(ctx.rpcUrl, { retryCount: 3, timeout: 20_000 }),
  });
  const data = encodeFunctionData({
    abi: params.abi as any,
    functionName: params.functionName,
    args: params.args as any,
  });
  const estimated = await ctx.client
    .estimateGas({ account: account.address, to: params.address, data })
    .catch(() => 300_000n);
  const gas = (estimated * 110n) / 100n;
  const nonce = await ctx.client.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const gasPrice = await ctx.client.getGasPrice();
  let maxFeePerGas = gasPrice;
  let maxPriorityFeePerGas = gasPrice / 10n;
  try {
    const fees = await ctx.client.estimateFeesPerGas();
    if (fees.maxFeePerGas != null) maxFeePerGas = fees.maxFeePerGas;
    if (fees.maxPriorityFeePerGas != null) {
      maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    }
  } catch {
    // keep gasPrice-derived fees
  }
  const serialized = await account.signTransaction({
    chainId: ctx.chain.id,
    to: params.address,
    data,
    gas,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const hash = await ctx.client.sendRawTransaction({
    serializedTransaction: serialized,
  });
  await ctx.client.waitForTransactionReceipt({ hash });
  return hash;
}

export type PasskeyConfig = {
  rpId: string;
  rpIdMatchesChain: boolean;
  registry: Address;
  passkeyIssuer: Address;
  stewardAddress: Address | null;
  explorerUrl: string;
  writeReady: boolean;
};

export async function passkeyConfig(): Promise<PasskeyConfig> {
  const ctx = getEvmReadContext(NETWORK);
  const onchainRpIdHash = (await ctx.client
    .readContract({
      address: PASSKEY_ISSUER,
      abi: ISSUER_ABI,
      functionName: "rpIdHash",
    })
    .catch(() => null)) as Hex | null;
  const configuredHash = `0x${createHash("sha256").update(RP_ID, "utf8").digest("hex")}`;
  return {
    rpId: RP_ID,
    rpIdMatchesChain: onchainRpIdHash === configuredHash,
    registry: REGISTRY,
    passkeyIssuer: PASSKEY_ISSUER,
    stewardAddress: relayAccount()?.address ?? null,
    explorerUrl: ctx.explorerUrl,
    writeReady: relayAccount() !== null,
  };
}

export type IssueChallenge = {
  digest: Hex;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  capabilityHash: Hex;
};

/** The EIP-712 digest the browser must place as the WebAuthn challenge. */
export async function prepareIssue(
  subject: Address,
  capability: string,
): Promise<IssueChallenge> {
  const ctx = getEvmReadContext(NETWORK);
  const nonce = (await ctx.client.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "issuerNonce",
    args: [PASSKEY_ISSUER],
  })) as bigint;
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + 365n * 24n * 3600n;
  const capHash = capabilityHash(capability) as Hex;
  const digest = (await ctx.client.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "hashTypedData",
    args: [PASSKEY_ISSUER, subject, capHash, issuedAt, expiresAt, nonce],
  })) as Hex;
  return {
    digest,
    nonce: nonce.toString(),
    issuedAt: issuedAt.toString(),
    expiresAt: expiresAt.toString(),
    capabilityHash: capHash,
  };
}

/** The packed revoke digest — must match the contract's abi.encodePacked. */
export function prepareRevoke(
  subject: Address,
  capHash: Hex,
  nonce: bigint,
): Hex {
  const chainId = BigInt(getEvmReadContext(NETWORK).chain.id);
  return keccak256(
    encodePacked(
      ["string", "address", "address", "bytes32", "uint256", "uint256"],
      ["LigisPasskeyRevoke", REGISTRY, subject, capHash, nonce, chainId],
    ),
  );
}

export async function enrollPasskey(
  keyId: Hex,
  qx: bigint,
  qy: bigint,
): Promise<Hex> {
  return relay({
    address: PASSKEY_ISSUER,
    abi: ISSUER_ABI,
    functionName: "registerPasskey",
    args: [keyId, qx, qy],
  });
}

export async function isEnrolled(keyId: Hex): Promise<boolean> {
  const ctx = getEvmReadContext(NETWORK);
  const [qx, qy] = (await ctx.client
    .readContract({
      address: PASSKEY_ISSUER,
      abi: ISSUER_ABI,
      functionName: "passkeys",
      args: [keyId],
    })
    .catch(() => [0n, 0n])) as [bigint, bigint];
  return qx !== 0n || qy !== 0n;
}

export async function issueCredential(args: {
  subject: Address;
  capability: string;
  issuedAt: bigint;
  expiresAt: bigint;
  nonce: bigint;
  keyId: Hex;
  authenticatorData: Hex;
  clientDataJSON: Hex;
  r: bigint;
  s: bigint;
}): Promise<{ tx: Hex; capable: boolean }> {
  const erc1271Sig = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes" },
      { type: "bytes" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [args.keyId, args.authenticatorData, args.clientDataJSON, args.r, args.s],
  );
  const tx = await relay({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "issue",
    args: [
      PASSKEY_ISSUER,
      args.subject,
      capabilityHash(args.capability) as Hex,
      args.issuedAt,
      args.expiresAt,
      args.nonce,
      erc1271Sig,
    ],
  });
  const capable = await readIsCapable(args.subject, args.capability);
  return { tx, capable };
}

export async function revokeCredential(args: {
  subject: Address;
  capability: string;
  nonce: bigint;
  keyId: Hex;
  authenticatorData: Hex;
  clientDataJSON: Hex;
  r: bigint;
  s: bigint;
}): Promise<{ tx: Hex; capable: boolean }> {
  const tx = await relay({
    address: PASSKEY_ISSUER,
    abi: ISSUER_ABI,
    functionName: "revokeCredential",
    args: [
      REGISTRY,
      args.subject,
      capabilityHash(args.capability) as Hex,
      args.nonce,
      args.keyId,
      args.authenticatorData,
      args.clientDataJSON,
      args.r,
      args.s,
    ],
  });
  const capable = await readIsCapable(args.subject, args.capability);
  return { tx, capable };
}

export async function readIsCapable(
  subject: Address,
  capability: string,
): Promise<boolean> {
  const ctx = getEvmReadContext(NETWORK);
  return (await ctx.client.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "isCapable",
    args: [subject, capabilityHash(capability) as Hex],
  })) as boolean;
}
