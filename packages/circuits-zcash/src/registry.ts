/**
 * Registry root builder (Week 3): turns EVM CredentialRegistry
 * `CredentialIssued` / `CredentialRevoked` events plus signed subject
 * registrations into the Poseidon tree the circuit proves against, and a
 * publishable root manifest the gate can trust.
 *
 * Subject → identity commitment mapping: the EVM registry keys credentials by
 * the subject's EVM address. A subject opts into private presentation by
 * signing (EIP-191, with that EVM key) a registration naming the Zcash
 * address it is paid at and its identity commitment H(identity_secret). The
 * builder only admits registrations whose signature recovers to the subject,
 * so nobody can claim another subject's credential for their own address.
 *
 * The manifest lists leaf hashes only (no subjects, addresses, or issuers):
 * leaves hide the holder because each includes the secret-derived commitment.
 */
import {
  decodeEventLog,
  parseAbi,
  recoverMessageAddress,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TREE_DEPTH,
  capabilityField,
  fieldHex,
  issuerField,
  parseField,
  payeeField,
} from "./fields.js";
import { CredentialTree, credentialLeaf, identityCommitment } from "./index.js";

export const REGISTRY_EVENTS_ABI = parseAbi([
  "event CredentialIssued(address indexed issuer, address indexed subject, bytes32 indexed capabilityHash, uint256 nonce, uint64 issuedAt, uint64 expiresAt)",
  "event CredentialRevoked(address indexed issuer, address indexed subject, bytes32 indexed capabilityHash, uint256 nonce, uint64 revokedAt)",
]);

export type RegistryEvent =
  | {
      type: "issued";
      issuer: Hex;
      subject: Hex;
      capabilityHash: Hex;
      nonce: string;
      issuedAt: string;
      expiresAt: string;
      blockNumber: string;
      logIndex: number;
    }
  | {
      type: "revoked";
      issuer: Hex;
      subject: Hex;
      capabilityHash: Hex;
      nonce: string;
      revokedAt: string;
      blockNumber: string;
      logIndex: number;
    };

export type SubjectRegistration = {
  /** EVM credential subject (CredentialRegistry `subject`). */
  subject: Hex;
  /** Zcash shielded address the subject is paid at (bound into the leaf). */
  zcashAddress: string;
  /** H(identity_secret), 0x field hex. */
  identityCommitment: Hex;
  /** EIP-191 signature by `subject` over `registrationMessage(...)`. */
  signature: Hex;
};

export type RootAttestation = {
  /** EIP-191 signer address (steward / operator). */
  signer: Hex;
  /** EIP-191 signature over `rootAttestationMessage(manifest)`. */
  signature: Hex;
  /** Optional on-chain transaction hash anchoring `root`. */
  anchorTxHash?: Hex;
  /** Optional EVM chain ID where `anchorTxHash` was broadcast. */
  anchorChainId?: number;
  /** Optional block number of the anchor transaction. */
  anchorBlockNumber?: string;
};

export type RootManifest = {
  version: 1;
  circuit: "ligis_credential_membership";
  depth: number;
  root: Hex;
  /** Unix seconds: credentials expired at this time are excluded. */
  asOf: number;
  leafCount: number;
  leaves: Hex[];
  source:
    | {
        kind: "chain";
        chainId: number;
        registry: Hex;
        fromBlock: string;
        toBlock: string;
      }
    | { kind: "fixture"; name: string };
  skipped: {
    revoked: number;
    expired: number;
    unregistered: number;
    badRegistration: number;
  };
  /** Optional steward signature and on-chain anchor reference. */
  attestation?: RootAttestation;
};

/** Canonical message a steward signs to attest to a published registry root. */
export function rootAttestationMessage(
  m: Pick<RootManifest, "root" | "asOf" | "leafCount" | "depth">,
): string {
  return [
    "ligis-zk-root:v1",
    `root:${m.root.toLowerCase()}`,
    `asOf:${m.asOf}`,
    `leafCount:${m.leafCount}`,
    `depth:${m.depth}`,
  ].join("\n");
}

/** Sign a `RootManifest` with a steward/operator private key and optional on-chain anchor metadata. */
export async function signRootManifest(
  manifest: RootManifest,
  privateKey: Hex,
  anchor?: { txHash: Hex; chainId: number; blockNumber?: string },
): Promise<RootManifest> {
  const acc = privateKeyToAccount(privateKey);
  const signature = await acc.signMessage({
    message: rootAttestationMessage(manifest),
  });
  return {
    ...manifest,
    attestation: {
      signer: acc.address,
      signature,
      ...(anchor
        ? {
            anchorTxHash: anchor.txHash,
            anchorChainId: anchor.chainId,
            ...(anchor.blockNumber
              ? { anchorBlockNumber: anchor.blockNumber }
              : {}),
          }
        : {}),
    },
  };
}

/** Canonical message a subject signs to register a commitment. */
export function registrationMessage(
  subject: string,
  zcashAddress: string,
  commitment: Hex,
): string {
  return [
    "ligis-zk-commitment:v1",
    `subject:${subject.toLowerCase()}`,
    `zcash:${zcashAddress.trim().toLowerCase()}`,
    `commitment:${commitment.toLowerCase()}`,
  ].join("\n");
}

/** Keep the latest valid registration per subject; report bad ones. */
export async function verifyRegistrations(
  regs: SubjectRegistration[],
): Promise<{ bySubject: Map<string, SubjectRegistration>; bad: number }> {
  const bySubject = new Map<string, SubjectRegistration>();
  let bad = 0;
  for (const r of regs) {
    try {
      if (parseField(r.identityCommitment) === null)
        throw new Error("commitment");
      const signer = await recoverMessageAddress({
        message: registrationMessage(
          r.subject,
          r.zcashAddress,
          r.identityCommitment,
        ),
        signature: r.signature,
      });
      if (signer.toLowerCase() !== r.subject.toLowerCase())
        throw new Error("signer");
      bySubject.set(r.subject.toLowerCase(), r);
    } catch {
      bad++;
    }
  }
  return { bySubject, bad };
}

type Credential = Extract<RegistryEvent, { type: "issued" }> & {
  revoked: boolean;
};

/**
 * Replay registry events in (block, logIndex) order and build the tree of
 * credentials that are unrevoked, unexpired at `asOf`, and registered.
 */
export async function buildRegistryRoot(args: {
  events: RegistryEvent[];
  registrations: SubjectRegistration[];
  asOf: number;
  source: RootManifest["source"];
  depth?: number;
}): Promise<{ tree: CredentialTree; manifest: RootManifest }> {
  const ordered = [...args.events].sort((a, b) => {
    const d = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    return d !== 0n ? (d < 0n ? -1 : 1) : a.logIndex - b.logIndex;
  });
  const key = (e: RegistryEvent) =>
    `${e.subject.toLowerCase()}:${e.capabilityHash.toLowerCase()}:${BigInt(e.nonce)}`;
  const creds = new Map<string, Credential>();
  for (const e of ordered) {
    if (e.type === "issued") creds.set(key(e), { ...e, revoked: false });
    else {
      const c = creds.get(key(e));
      if (c && c.issuer.toLowerCase() === e.issuer.toLowerCase())
        c.revoked = true;
    }
  }
  const { bySubject, bad } = await verifyRegistrations(args.registrations);
  const skipped = {
    revoked: 0,
    expired: 0,
    unregistered: 0,
    badRegistration: bad,
  };
  const leaves: bigint[] = [];
  for (const c of creds.values()) {
    if (c.revoked) {
      skipped.revoked++;
      continue;
    }
    if (BigInt(c.expiresAt) <= BigInt(args.asOf)) {
      skipped.expired++;
      continue;
    }
    const reg = bySubject.get(c.subject.toLowerCase());
    if (!reg) {
      skipped.unregistered++;
      continue;
    }
    leaves.push(
      await credentialLeaf({
        identityCommitment: BigInt(reg.identityCommitment),
        payeeHash: payeeField(reg.zcashAddress),
        capabilityHash: capabilityField(c.capabilityHash),
        issuer: issuerField(c.issuer),
        expiresAt: BigInt(c.expiresAt),
        nonce: BigInt(c.nonce),
      }),
    );
  }
  const depth = args.depth ?? TREE_DEPTH;
  const tree = await CredentialTree.build(leaves, depth);
  return {
    tree,
    manifest: {
      version: 1,
      circuit: "ligis_credential_membership",
      depth,
      root: fieldHex(tree.root),
      asOf: args.asOf,
      leafCount: leaves.length,
      leaves: leaves.map(fieldHex),
      source: args.source,
      skipped,
    },
  };
}

/** Validate an untrusted manifest, recompute its root from its leaves, and verify any steward attestation. */
export async function checkManifest(
  raw: unknown,
  opts?: { expectedSigner?: string },
): Promise<RootManifest | string> {
  const m = raw as Partial<RootManifest> | null;
  if (!m || m.version !== 1 || m.circuit !== "ligis_credential_membership") {
    return "not a ligis root manifest (version 1)";
  }
  if (m.depth !== TREE_DEPTH)
    return `manifest depth ${m.depth} ≠ circuit depth ${TREE_DEPTH}`;
  if (!Array.isArray(m.leaves) || m.leaves.length !== m.leafCount)
    return "leaf count mismatch";
  const leaves = m.leaves.map((l) => parseField(l));
  if (leaves.some((l) => l === null)) return "manifest has a non-field leaf";
  const tree = await CredentialTree.build(leaves as bigint[], m.depth);
  if (typeof m.root !== "string" || parseField(m.root) !== tree.root) {
    return "manifest root does not match its leaves";
  }
  if (typeof m.asOf !== "number") return "manifest asOf missing";
  if (m.attestation !== undefined) {
    const att = m.attestation;
    if (
      !att ||
      typeof att.signer !== "string" ||
      typeof att.signature !== "string"
    ) {
      return "manifest attestation malformed";
    }
    try {
      const recovered = await recoverMessageAddress({
        message: rootAttestationMessage({
          root: m.root,
          asOf: m.asOf,
          leafCount: m.leafCount,
          depth: m.depth,
        }),
        signature: att.signature as Hex,
      });
      if (recovered.toLowerCase() !== att.signer.toLowerCase()) {
        return "manifest attestation signature does not match signer";
      }
    } catch {
      return "manifest attestation signature invalid";
    }
  }
  if (opts?.expectedSigner) {
    if (!m.attestation) {
      return "manifest missing required steward attestation";
    }
    if (
      m.attestation.signer.toLowerCase() !== opts.expectedSigner.toLowerCase()
    ) {
      return `manifest signer ${m.attestation.signer} ≠ expected ${opts.expectedSigner}`;
    }
  }
  return m as RootManifest;
}

/**
 * Holder side: locate my credential in a manifest and return the witness
 * pieces (`leaf_index`, `merkle_path`) plus the root.
 */
export async function witnessFromManifest(
  manifest: RootManifest,
  cred: {
    identitySecret: bigint;
    zcashAddress: string;
    capability: string;
    issuer: string;
    expiresAt: bigint;
    nonce: bigint;
  },
): Promise<{ tree: CredentialTree; index: number } | null> {
  const leaf = await credentialLeaf({
    identityCommitment: await identityCommitment(cred.identitySecret),
    payeeHash: payeeField(cred.zcashAddress),
    capabilityHash: capabilityField(cred.capability),
    issuer: issuerField(cred.issuer),
    expiresAt: cred.expiresAt,
    nonce: cred.nonce,
  });
  const index = manifest.leaves.findIndex((l) => BigInt(l) === leaf);
  if (index < 0) return null;
  const tree = await CredentialTree.build(
    manifest.leaves.map((l) => BigInt(l)),
    manifest.depth,
  );
  return { tree, index };
}

/** Decode raw RPC logs from the CredentialRegistry into RegistryEvents. */
export function decodeRegistryLogs(
  logs: Array<{
    topics: [Hex, ...Hex[]] | Hex[];
    data: Hex;
    blockNumber: bigint | null;
    logIndex: number | null;
  }>,
): RegistryEvent[] {
  const out: RegistryEvent[] = [];
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: REGISTRY_EVENTS_ABI,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
    } catch {
      continue;
    }
    const base = {
      issuer: decoded.args.issuer,
      subject: decoded.args.subject,
      capabilityHash: decoded.args.capabilityHash,
      nonce: decoded.args.nonce.toString(),
      blockNumber: (log.blockNumber ?? 0n).toString(),
      logIndex: log.logIndex ?? 0,
    };
    if (decoded.eventName === "CredentialIssued") {
      out.push({
        type: "issued",
        ...base,
        issuedAt: decoded.args.issuedAt.toString(),
        expiresAt: decoded.args.expiresAt.toString(),
      });
    } else {
      out.push({
        type: "revoked",
        ...base,
        revokedAt: decoded.args.revokedAt.toString(),
      });
    }
  }
  return out;
}

/** Read-only: fetch registry events over JSON-RPC in block chunks. */
export async function fetchRegistryEvents(
  client: Pick<PublicClient, "getLogs" | "getBlockNumber">,
  registry: Hex,
  fromBlock: bigint,
  toBlock?: bigint,
  chunk = 5_000n,
): Promise<{ events: RegistryEvent[]; toBlock: bigint }> {
  const end = toBlock ?? (await client.getBlockNumber());
  const logs = [];
  for (let b = fromBlock; b <= end; b += chunk) {
    const to = b + chunk - 1n > end ? end : b + chunk - 1n;
    logs.push(
      ...(await client.getLogs({
        address: registry,
        events: REGISTRY_EVENTS_ABI,
        fromBlock: b,
        toBlock: to,
      })),
    );
  }
  return { events: decodeRegistryLogs(logs as never), toBlock: end };
}
