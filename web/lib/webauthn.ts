/**
 * Browser WebAuthn helpers for the passkey ceremony.
 *
 * The credential the browser creates is a real platform passkey (Touch ID /
 * Windows Hello / Android). The public key is enrolled on the PasskeyIssuer
 * contract; later `credentials.get()` assertions are verified on-chain by
 * Monad's P256 precompile (EIP-7951 at 0x0100).
 */
import { keccak256, toHex, type Hex } from "viem";

export function bytesToHex(b: ArrayBuffer | Uint8Array): Hex {
  return toHex(new Uint8Array(b));
}

export function hexToBytes(h: Hex): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(h)) throw new Error("Invalid hex bytes.");
  const clean = h.slice(2);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function webauthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== "undefined" &&
    !!navigator.credentials
  );
}

export type EnrolledPasskey = {
  /** Raw credential ID — needed later as allowCredentials input. */
  credentialId: Hex;
  /** On-chain keyId: keccak256(credentialId). */
  keyId: Hex;
  qx: string;
  qy: string;
};

/**
 * navigator.credentials.create() — registers a new passkey locally and returns
 * the P-256 public key coordinates to enroll on-chain.
 */
export async function createPasskey(
  rpId: string,
  userName: string,
): Promise<EnrolledPasskey> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { name: "Ligis", id: rpId },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)) as BufferSource,
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      attestation: "none",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled.");

  const response = cred.response as AuthenticatorAttestationResponse;
  if (response.getPublicKeyAlgorithm?.() !== -7) {
    throw new Error("Expected an ES256 P-256 passkey.");
  }
  const spki = response.getPublicKey?.();
  if (!spki) {
    throw new Error(
      "This browser did not expose the passkey public key (getPublicKey unsupported).",
    );
  }
  // P-256 SPKI DER ends with the 65-byte uncompressed point 0x04 ‖ qx ‖ qy.
  const bytes = new Uint8Array(spki);
  if (bytes.length < 65 || bytes[bytes.length - 65] !== 0x04) {
    throw new Error("Unexpected passkey public key format (expected P-256).");
  }
  const qx = BigInt(`0x${toHex(bytes.slice(-64, -32)).slice(2)}`);
  const qy = BigInt(`0x${toHex(bytes.slice(-32)).slice(2)}`);
  const credentialId = bytesToHex(cred.rawId);
  return {
    credentialId,
    keyId: keccak256(credentialId),
    qx: qx.toString(),
    qy: qy.toString(),
  };
}

export type PasskeyAssertion = {
  authenticatorData: Hex;
  clientDataJSON: Hex;
  r: string;
  s: string;
};

/**
 * navigator.credentials.get() — signs `challenge` (the on-chain digest) with
 * the enrolled passkey. Returns the assertion fields the contract verifies.
 */
export async function signChallenge(
  rpId: string,
  challenge: Hex,
  credentialId: Hex,
): Promise<PasskeyAssertion> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: hexToBytes(challenge) as BufferSource,
      rpId,
      allowCredentials: [
        { type: "public-key", id: hexToBytes(credentialId) as BufferSource },
      ],
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey assertion was cancelled.");
  if (bytesToHex(cred.rawId).toLowerCase() !== credentialId.toLowerCase()) {
    throw new Error("Authenticator returned a different passkey.");
  }

  const response = cred.response as AuthenticatorAssertionResponse;
  const client = JSON.parse(new TextDecoder().decode(response.clientDataJSON));
  if (
    client.type !== "webauthn.get" ||
    client.origin !== window.location.origin ||
    client.challenge !==
      btoa(String.fromCharCode(...hexToBytes(challenge)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "") ||
    client.crossOrigin === true
  )
    throw new Error("Assertion is not bound to this origin and challenge.");
  const auth = new Uint8Array(response.authenticatorData);
  if (auth.length < 37 || (auth[32] & 5) !== 5) {
    throw new Error("User presence and verification are required.");
  }
  const { r, s } = derToRs(response.signature);
  return {
    authenticatorData: bytesToHex(response.authenticatorData),
    clientDataJSON: bytesToHex(response.clientDataJSON),
    r: r.toString(),
    s: s.toString(),
  };
}

/** Parse an ASN.1 DER ECDSA signature into (r, s), each left-padded to 32 bytes. */
export function derToRs(der: ArrayBuffer): { r: bigint; s: bigint } {
  const b = new Uint8Array(der);
  if (b.length < 8 || b[0] !== 0x30 || b[1] !== b.length - 2) {
    throw new Error("Bad DER signature");
  }
  let i = 2;
  const readInteger = () => {
    if (b[i++] !== 0x02) throw new Error("Bad DER integer");
    const len = b[i++];
    if (!len || len > 33 || i + len > b.length)
      throw new Error("Bad DER length");
    const x = b.slice(i, i + len);
    i += len;
    if ((x[0] & 0x80) !== 0 || (len > 1 && x[0] === 0 && (x[1] & 0x80) === 0)) {
      throw new Error("Non-canonical DER integer");
    }
    const stripped = x[0] === 0 && x.length > 1 ? x.slice(1) : x;
    if (stripped.length > 32) throw new Error("DER integer exceeds P-256 size");
    const n = BigInt(toHex(stripped));
    if (
      n === 0n ||
      n >= 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
    ) {
      throw new Error("Invalid P-256 signature scalar");
    }
    return n;
  };
  const r = readInteger();
  const s = readInteger();
  if (i !== b.length) throw new Error("Trailing DER bytes");
  return { r, s };
}

// ---------- local persistence ----------

const STORAGE_KEY = "ligis.passkey.v1";

export type StoredPasskey = EnrolledPasskey & { rpId: string };

export function loadPasskey(rpId: string): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPasskey;
    return parsed.rpId === rpId &&
      /^0x(?:[0-9a-fA-F]{2})+$/.test(parsed.credentialId) &&
      parsed.keyId === keccak256(parsed.credentialId) &&
      /^\d+$/.test(parsed.qx) &&
      /^\d+$/.test(parsed.qy)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function storePasskey(pk: StoredPasskey) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pk));
  } catch {
    // private mode — ceremony still works for this session
  }
}
