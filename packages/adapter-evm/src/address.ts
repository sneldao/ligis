/**
 * EVM-specific address parsing.
 */
import type { Address } from "viem";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** Validate a string as an Ethereum address, throwing on bad input. */
export function parseAddress(s: string): Address {
  if (!ADDR_RE.test(s)) throw new Error(`Invalid address: ${s}`);
  return s as Address;
}
