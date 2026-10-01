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
        userVerification: "preferred",
      },
      attestation: "none",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled.");

  const response = cred.response as AuthenticatorAttestationResponse;
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
      userVerification: "preferred",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey assertion was cancelled.");

  const response = cred.response as AuthenticatorAssertionResponse;
  const { r, s } = derToRs(response.signature);
  return {
    authenticatorData: bytesToHex(response.authenticatorData),
    clientDataJSON: bytesToHex(response.clientDataJSON),
    r: r.toString(),
    s: s.toString(),
  };
}

/** Parse an ASN.1 DER ECDSA signature into (r, s), each left-padded to 32 bytes. */
function derToRs(der: ArrayBuffer): { r: bigint; s: bigint } {
  const b = new Uint8Array(der);
  let i = 0;
  const readLen = () => {
    let len = b[i++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | b[i++];
    }
    return len;
  };
  if (b[i++] !== 0x30) throw new Error("Bad DER signature");
  readLen(); // sequence length
  if (b[i++] !== 0x02) throw new Error("Bad DER signature (r)");
  const rLen = readLen();
  const rBytes = b.slice(i, i + rLen);
  i += rLen;
  if (b[i++] !== 0x02) throw new Error("Bad DER signature (s)");
  const sLen = readLen();
  const sBytes = b.slice(i, i + sLen);
  const to32 = (x: Uint8Array) => {
    const stripped = x.length > 32 && x[0] === 0 ? x.slice(1) : x;
    const out = new Uint8Array(32);
    out.set(stripped, 32 - stripped.length);
    return BigInt(`0x${toHex(out).slice(2)}`);
  };
  return { r: to32(rBytes), s: to32(sBytes) };
}

// ---------- local persistence ----------

const STORAGE_KEY = "ligis.passkey.v1";

export type StoredPasskey = EnrolledPasskey & { rpId: string };

export function loadPasskey(rpId: string): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPasskey;
    return parsed.rpId === rpId ? parsed : null;
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
