import type { Address } from "viem";
import { keccak_256 } from "@noble/hashes/sha3";

const TRUNCATE_GLYPH = "··";

/**
 * Compute keccak256 of a hex string's ASCII bytes and return the result
 * as a lowercase hex string (without 0x prefix). Used by `toChecksumAddress`
 * for EIP-55 — the spec hashes the ASCII representation of the lowercase
 * hex address, not the binary address.
 */
function keccak256Str(hex: string): string {
  const asciiBytes = new TextEncoder().encode(hex);
  const hash = keccak_256(asciiBytes);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function truncateAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + TRUNCATE_GLYPH.length) return address;
  return `${address.slice(0, head)}${TRUNCATE_GLYPH}${address.slice(-tail)}`;
}

export function truncateHash(hash: string, head = 10, tail = 6): string {
  return truncateAddress(hash, head, tail);
}

export function isAddressLike(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Lightweight EIP-55 checksum address conversion.
 *
 * Avoids importing viem's `getAddress` in client components that only
 * need checksumming (e.g. CommandPalette) — viem pulls in a large
 * bundle of EVM utilities that aren't needed for a simple case-flip.
 */
export function toChecksumAddress(addr: string): string {
  if (!isAddressLike(addr)) return addr;
  const lower = addr.toLowerCase().slice(2);
  // keccak256 of the lowercase hex string (without 0x prefix)
  // We use a minimal inline keccak since @noble/hashes is already a dep.
  const hash = keccak256Str(lower);
  let result = "0x";
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i];
    if (char >= "0" && char <= "9") {
      result += char;
    } else {
      const nibble = parseInt(hash[i], 16);
      result += nibble >= 8 ? char.toUpperCase() : char;
    }
  }
  return result as Address;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(unixSeconds: bigint | number): string {
  const seconds = typeof unixSeconds === "bigint" ? Number(unixSeconds) : unixSeconds;
  const delta = seconds - Math.floor(Date.now() / 1000);
  const abs = Math.abs(delta);
  if (abs < 60) return RELATIVE.format(Math.round(delta), "second");
  if (abs < 3600) return RELATIVE.format(Math.round(delta / 60), "minute");
  if (abs < 86400) return RELATIVE.format(Math.round(delta / 3600), "hour");
  if (abs < 2592000) return RELATIVE.format(Math.round(delta / 86400), "day");
  if (abs < 31536000) return RELATIVE.format(Math.round(delta / 2592000), "month");
  return RELATIVE.format(Math.round(delta / 31536000), "year");
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });

export function monthYear(unixSeconds: bigint | number): string {
  const seconds = typeof unixSeconds === "bigint" ? Number(unixSeconds) : unixSeconds;
  return MONTH.format(new Date(seconds * 1000)).toLowerCase();
}
