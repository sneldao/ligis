/**
 * x402 Client — signs payment payloads for Casper x402 payments.
 *
 * Implements the client side of the x402 protocol for Casper:
 * 1. Receive 402 PaymentRequired from the resource server
 * 2. Build an EIP-712 TransferWithAuthorization message
 * 3. Sign it with the Casper secp256k1 key
 * 4. Send the payment in the X-PAYMENT header (base64-encoded)
 *
 * The EIP-712 domain and types match the casper-x402 reference implementation
 * (make-software/casper-x402). The signature format is:
 *   [1 algorithm byte (02=secp256k1) | 64 raw signature bytes]
 */
import {
  CASPER_DOMAIN_TYPES,
  hashTypedData,
  buildDomain,
} from "@casper-ecosystem/casper-eip-712";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

/** x402 PaymentRequirements from the 402 response. */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: { name: string; version: string; [k: string]: unknown };
}

/** The signed payment payload sent in the X-PAYMENT header. */
export interface PaymentPayload {
  x402Version: number;
  resource: { url: string; description?: string; mimeType?: string };
  accepted: {
    scheme: "exact";
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: Record<string, unknown>;
  };
  payload: {
    signature: string;
    publicKey: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/**
 * Create a signed x402 payment payload.
 *
 * @param privateKeyHex - secp256k1 private key (hex, with or without 0x prefix)
 * @param publicKeyHex - Casper public key hex (with algorithm prefix, e.g. "02...")
 * @param accountHashHex - Casper account hash hex (without "account-hash-" prefix, without "00" prefix)
 * @param requirements - PaymentRequirements from the 402 response
 * @returns Base64-encoded PaymentPayload for the X-PAYMENT header
 */
export function createPaymentPayload(
  privateKeyHex: string,
  publicKeyHex: string,
  accountHashHex: string,
  requirements: PaymentRequirements,
): string {
  const cleanPriv = privateKeyHex.startsWith("0x")
    ? privateKeyHex.slice(2)
    : privateKeyHex;
  const cleanPub = publicKeyHex.startsWith("0x")
    ? publicKeyHex.slice(2)
    : publicKeyHex;

  // Token metadata for EIP-712 domain
  const name = requirements.extra?.name ?? "Cep18x402";
  const version = requirements.extra?.version ?? "1";

  // Build the EIP-712 domain (Casper-specific: chain_name + contract_package_hash)
  // The asset is the CEP-18 token package hash. If empty (local CSPR mode),
  // use a 32-byte zero hash as placeholder — the signature is still valid
  // EIP-712, just not tied to a specific token contract.
  const assetRaw = requirements.asset.replace(/^0x/, "");
  const asset =
    assetRaw.length === 64
      ? `0x${assetRaw}`
      : "0x0000000000000000000000000000000000000000000000000000000000000000";
  const domain = buildDomain(name, version, requirements.network, asset);

  // Build the authorization message
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 600;
  const validBefore = now + requirements.maxTimeoutSeconds;

  // Generate a random 32-byte nonce
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonceHex = bytesToHex(nonceBytes);

  // Account hash format for EIP-712: "0x" + "00" tag byte + 32-byte account hash
  // The "00" prefix is the Casper EIP-712 address tag for account hashes.
  const fromAddress = `0x00${accountHashHex}`;
  const toAddress = requirements.payTo.startsWith("0x")
    ? requirements.payTo
    : `0x${requirements.payTo}`;

  const message = {
    from: fromAddress,
    to: toAddress,
    value: BigInt(requirements.maxAmountRequired),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: `0x${nonceHex}`,
  };

  // Compute the EIP-712 typed-data digest
  const digest = hashTypedData(
    domain,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    "TransferWithAuthorization",
    message,
    { domainTypes: CASPER_DOMAIN_TYPES },
  );

  // Sign with secp256k1
  const priv = hexToBytes(cleanPriv);
  const sig = secp256k1.sign(digest, priv);
  const compact = sig.toCompactRawBytes();

  // Casper x402 signature format: [1 algorithm byte | 64 signature bytes]
  const fullSig = new Uint8Array(65);
  fullSig[0] = 0x02; // secp256k1 algorithm byte
  fullSig.set(compact, 1);
  const signatureHex = bytesToHex(fullSig);

  const payload: PaymentPayload = {
    x402Version: 2,
    resource: {
      url: requirements.resource,
      description: requirements.description,
      mimeType: requirements.mimeType,
    },
    accepted: {
      scheme: "exact",
      network: requirements.network,
      asset: requirements.asset.replace(/^0x/, ""),
      amount: requirements.maxAmountRequired,
      payTo: requirements.payTo.replace(/^0x/, ""),
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: { name, version },
    },
    payload: {
      signature: signatureHex,
      publicKey: cleanPub,
      authorization: {
        from: `00${accountHashHex}`,
        to: requirements.payTo.replace(/^0x/, ""),
        value: requirements.maxAmountRequired,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce: nonceHex,
      },
    },
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Parse a 402 response body to extract PaymentRequirements.
 */
export function parsePaymentRequirements(body: any): PaymentRequirements {
  const accepts = body?.accepts?.[0];
  if (!accepts) throw new Error("No payment requirements in 402 response");
  return accepts as PaymentRequirements;
}
