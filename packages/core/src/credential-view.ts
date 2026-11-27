/**
 * Dependency-free decoder for the CredentialRegistry `CredentialView` byte
 * layout — shared by the Node adapter (casper-client CLI reads) and the
 * browser adapter (JSON-RPC reads) so both sides parse identical bytes
 * identically. Uses only Uint8Array/DataView/TextDecoder: no Node APIs,
 * no chain SDKs.
 *
 * On-chain serialization (Odra `List<U8>` of the packed struct):
 *   u32 LE length prefix ++ payload
 *
 * v1 payload (exactly 70 bytes, no claim field):
 *   issuer: [u8; 20] | subject: [u8; 32] | issued_at: u64 LE
 *   | expires_at: u64 LE | revoked: bool | valid: bool
 *
 * v2 payload (≥ 74 bytes):
 *   issuer: [u8; 20] | subject: [u8; 32] | claim: u32 LE len ++ utf8
 *   | issued_at: u64 LE | expires_at: u64 LE | revoked: bool | valid: bool
 */
import type { CredentialView } from "./types.js";

export type { CredentialView };

const V1_PAYLOAD_LEN = 70;
const V2_MIN_PAYLOAD_LEN = 74;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function readU64LE(view: DataView, at: number): string {
  const lo = BigInt(view.getUint32(at, true));
  const hi = BigInt(view.getUint32(at + 4, true));
  return (hi * 0x1_0000_0000n + lo).toString();
}

/**
 * Decode a serialized CredentialView from its hex string. Returns null for
 * malformed input (bad hex, truncated length prefix, neither v1 nor v2
 * length, claim overrun) — callers decide whether null means "no
 * credential" or "unparseable bytes".
 */
export function parseCredentialViewHex(
  hexBytes: string,
): CredentialView | null {
  const all = hexToBytes(hexBytes);
  if (!all || all.length < 4) return null;
  const dv = new DataView(all.buffer, all.byteOffset, all.byteLength);
  const len = dv.getUint32(0, true);
  if (4 + len > all.length) return null;
  const data = all.subarray(4, 4 + len);
  const issuer = "0x" + bytesToHex(data.subarray(0, 20));
  if (data.length === V1_PAYLOAD_LEN) {
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      issuer,
      claim: "",
      issuedAt: readU64LE(d, 52),
      expiresAt: readU64LE(d, 60),
      revoked: data[68] !== 0,
      valid: data[69] !== 0,
    };
  }
  if (data.length < V2_MIN_PAYLOAD_LEN) return null;
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const claimLen = d.getUint32(52, true);
  // claim ++ u64 ++ u64 ++ bool ++ bool must fit after the length field.
  if (56 + claimLen + 18 > data.length) return null;
  const claim = new TextDecoder().decode(data.subarray(56, 56 + claimLen));
  const tail = 56 + claimLen;
  return {
    issuer,
    claim,
    issuedAt: readU64LE(d, tail),
    expiresAt: readU64LE(d, tail + 8),
    revoked: data[tail + 16] !== 0,
    valid: data[tail + 17] !== 0,
  };
}
