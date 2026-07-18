import {
  keccak256,
  createPublicClient,
  http,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type {
  AttestationEvidenceRef,
  AttestationVerificationRequest,
  AttestationVerifier,
  ExternalAttestation,
} from "@ligis/core";

export const EAS_ABI = [
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
] as const;

export const EAS_ZERO_UID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface EasAttestationRecord {
  uid: Hex;
  schema: Hex;
  time: bigint;
  expirationTime: bigint;
  revocationTime: bigint;
  refUID: Hex;
  recipient: Address;
  attester: Address;
  revocable: boolean;
  data: Hex;
}

export interface EasAttestationVerifierOptions {
  client: PublicClient;
  easAddress: Address;
  chainId: number | string;
  decodeClaims?: (
    attestation: EasAttestationRecord,
  ) => Record<string, string | number | boolean>;
  now?: () => Date;
}

export interface EasAttestationVerifierEnv {
  LIGIS_EAS_ADDRESS?: string;
  LIGIS_EAS_RPC_URL?: string;
  LIGIS_EAS_CHAIN_ID?: string;
}

export function createEasAttestationVerifierFromEnv(
  env: EasAttestationVerifierEnv = process.env,
): EasAttestationVerifier {
  const easAddress = env.LIGIS_EAS_ADDRESS;
  const rpcUrl = env.LIGIS_EAS_RPC_URL;
  const chainId = env.LIGIS_EAS_CHAIN_ID;

  if (!easAddress) {
    throw new Error("LIGIS_EAS_ADDRESS is required for EAS-backed issuance");
  }
  if (!rpcUrl) {
    throw new Error("LIGIS_EAS_RPC_URL is required for EAS-backed issuance");
  }
  if (!chainId) {
    throw new Error("LIGIS_EAS_CHAIN_ID is required for EAS-backed issuance");
  }

  return new EasAttestationVerifier({
    client: createPublicClient({ transport: http(rpcUrl) }),
    easAddress: easAddress as Address,
    chainId,
  });
}

export function normalizeEasAttestation(
  record: EasAttestationRecord,
  options: {
    chainId: number | string;
    checkedAt?: Date;
    decodeClaims?: (
      attestation: EasAttestationRecord,
    ) => Record<string, string | number | boolean>;
  },
): ExternalAttestation {
  const checkedAt = options.checkedAt ?? new Date();
  const nowSeconds = BigInt(Math.floor(checkedAt.getTime() / 1000));
  const status =
    record.uid === EAS_ZERO_UID || record.time === 0n || record.attester === zeroAddress
      ? "invalid"
      : record.revocationTime > 0n
        ? "revoked"
        : record.expirationTime > 0n && record.expirationTime <= nowSeconds
          ? "expired"
          : "valid";

  const evidence: AttestationEvidenceRef = {
    source: "eas",
    uid: record.uid,
    chainId: String(options.chainId),
    schema: record.schema,
    dataHash: keccak256(record.data),
  };

  return {
    evidence,
    subject: record.recipient,
    attester: record.attester,
    status,
    issuedAt: record.time > 0n ? secondsToIso(record.time) : undefined,
    expiresAt:
      record.expirationTime > 0n ? secondsToIso(record.expirationTime) : undefined,
    claims: options.decodeClaims?.(record) ?? {},
    checkedAt: checkedAt.toISOString(),
  };
}

export class EasAttestationVerifier implements AttestationVerifier {
  readonly source = "eas" as const;

  constructor(private readonly options: EasAttestationVerifierOptions) {}

  async verify(request: AttestationVerificationRequest): Promise<ExternalAttestation> {
    if (request.source !== this.source || request.reference.source !== this.source) {
      throw new Error("EasAttestationVerifier only accepts EAS verification requests");
    }
    if (!isBytes32Hex(request.reference.uid)) {
      throw new Error("EAS attestation UID must be a bytes32 hex string");
    }

    const record = (await this.options.client.readContract({
      address: this.options.easAddress,
      abi: EAS_ABI,
      functionName: "getAttestation",
      args: [request.reference.uid as Hex],
    })) as EasAttestationRecord;

    const attestation = normalizeEasAttestation(record, {
      chainId: request.reference.chainId ?? this.options.chainId,
      checkedAt: this.options.now?.(),
      decodeClaims: this.options.decodeClaims,
    });

    const subjectMatches =
      request.subject.toLowerCase() === attestation.subject.toLowerCase();
    const schemaMatches =
      !request.reference.schema ||
      request.reference.schema.toLowerCase() === record.schema.toLowerCase();

    return subjectMatches && schemaMatches
      ? attestation
      : { ...attestation, status: "invalid" };
  }
}

function secondsToIso(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

function isBytes32Hex(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
