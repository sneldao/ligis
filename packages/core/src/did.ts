/**
 * DID-style agent identifiers.
 *
 * An AgentDid pins an agent to a specific chain. Cross-chain logic never
 * stores raw addresses; it stores DIDs and asks the matching adapter to
 * resolve them.
 *
 *   did:ligis:<chain-id>:<chain-native-id>
 */
import type { AgentDid, ChainId } from "./types.js";

const DID_RE = /^did:ligis:([a-z0-9-]+):(.+)$/;

export interface ParsedDid {
  chainId: ChainId;
  nativeId: string;
}

export function formatDid(chainId: ChainId, nativeId: string): AgentDid {
  return `did:ligis:${chainId}:${nativeId}`;
}

export function parseDid(did: string): ParsedDid {
  const m = DID_RE.exec(did);
  if (!m) throw new Error(`Invalid agent DID: ${did}`);
  return { chainId: m[1]!, nativeId: m[2]! };
}

export function isDid(s: string): s is AgentDid {
  return DID_RE.test(s);
}
