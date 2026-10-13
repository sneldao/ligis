import "server-only";
import { createHash } from "node:crypto";
import {
  encodePacked,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { capabilityHash } from "@ligis/core";
import { getEvmReadContext } from "./chain";
import networks from "../../assets/networks.json";

const NETWORK = "monad-testnet";
const deployment = networks.deployment[NETWORK];
export const PASSKEY_REGISTRY = deployment.credentialRegistry as Address;
export const PASSKEY_ISSUER = deployment.passkeyIssuer as Address;
const ABI = parseAbi([
  "function rpIdHash() view returns (bytes32)",
  "function originHash() view returns (bytes32)",
  "function passkeys(bytes32) view returns (uint256 qx, uint256 qy)",
  "function issuerNonce(address) view returns (uint256)",
  "function hashTypedData(address,address,bytes32,uint256,uint256,uint256) view returns (bytes32)",
  "function isCapable(address,bytes32) view returns (bool)",
]);

export function fixtureEnabled(
  env: { NODE_ENV?: string; LIGIS_PASSKEY_FIXTURE?: string } = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.LIGIS_PASSKEY_FIXTURE === "1";
}

export async function passkeyConfig() {
  const rpId = process.env.LIGIS_PASSKEY_RP_ID ?? "ligis.vercel.app";
  const origin = process.env.LIGIS_PASSKEY_ORIGIN ?? `https://${rpId}`;
  const fixture = fixtureEnabled();
  let contextMatches = false;
  let readState = "unavailable";
  const ctx = getEvmReadContext(NETWORK);
  if (!fixture) {
    try {
      const [rp, originHash] = await Promise.all([
        ctx.client.readContract({
          address: PASSKEY_ISSUER,
          abi: ABI,
          functionName: "rpIdHash",
        }),
        ctx.client.readContract({
          address: PASSKEY_ISSUER,
          abi: ABI,
          functionName: "originHash",
        }),
      ]);
      contextMatches =
        rp === sha256Hex(rpId) && originHash === sha256Hex(origin);
      readState = contextMatches ? "matched" : "context-mismatch";
    } catch {
      // Legacy bytecode has no originHash. Never treat source hardening as cutover.
      readState = "cutover-or-read-unavailable";
    }
  }
  return {
    rpId,
    origin,
    rpIdMatchesChain: contextMatches,
    readState,
    registry: PASSKEY_REGISTRY,
    passkeyIssuer: PASSKEY_ISSUER,
    explorerUrl: ctx.explorerUrl,
    writeReady: false,
    fixture,
    sponsorMode:
      process.env.LIGIS_PASSKEY_SPONSOR_MODE === "privy"
        ? "unavailable"
        : "off",
    reason:
      "Live writes disabled: authorized hardened-contract cutover, durable sponsorship quotas and Monad sponsor configuration are not verified. No steward fallback.",
    onboardingAppId:
      process.env.LIGIS_PASSKEY_PRIVY_ONBOARDING === "1" && !fixture
        ? (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? null)
        : null,
  };
}

function sha256Hex(text: string): Hex {
  return `0x${createHash("sha256").update(text).digest("hex")}`;
}

export async function prepareIssue(subject: Address, capability: string) {
  if (capability !== "demo.passkey")
    throw new Error("Only demo.passkey is supported here.");
  const ctx = getEvmReadContext(NETWORK);
  const nonce = await ctx.client.readContract({
    address: PASSKEY_REGISTRY,
    abi: ABI,
    functionName: "issuerNonce",
    args: [PASSKEY_ISSUER],
  });
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + 3600n;
  const capHash = capabilityHash(capability) as Hex;
  const digest = await ctx.client.readContract({
    address: PASSKEY_REGISTRY,
    abi: ABI,
    functionName: "hashTypedData",
    args: [PASSKEY_ISSUER, subject, capHash, issuedAt, expiresAt, nonce],
  });
  return {
    digest,
    nonce: String(nonce),
    issuedAt: String(issuedAt),
    expiresAt: String(expiresAt),
    capabilityHash: capHash,
  };
}

export function prepareRevoke(
  subject: Address,
  capHash: Hex,
  nonce: bigint,
): Hex {
  return keccak256(
    encodePacked(
      [
        "string",
        "address",
        "address",
        "address",
        "bytes32",
        "uint256",
        "uint256",
      ],
      [
        "LigisPasskeyRevoke",
        PASSKEY_ISSUER,
        PASSKEY_REGISTRY,
        subject,
        capHash,
        nonce,
        10143n,
      ],
    ),
  );
}

export async function isEnrolled(keyId: Hex): Promise<boolean> {
  const [qx, qy] = await getEvmReadContext(NETWORK).client.readContract({
    address: PASSKEY_ISSUER,
    abi: ABI,
    functionName: "passkeys",
    args: [keyId],
  });
  return qx !== 0n || qy !== 0n;
}

export async function readIsCapable(
  subject: Address,
  capability: string,
): Promise<boolean> {
  return getEvmReadContext(NETWORK).client.readContract({
    address: PASSKEY_REGISTRY,
    abi: ABI,
    functionName: "isCapable",
    args: [subject, capabilityHash(capability) as Hex],
  });
}
