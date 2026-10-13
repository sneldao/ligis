export const IDENTITY = "0x8004a818bfb912233c491871b3d84c89a494bd9e";
export const REPUTATION = "0x8004b663056a597dffe9eccc1965a193b7388713";
export const ZERO = "0x0000000000000000000000000000000000000000";

export function scopedId(
  chainId: number,
  registry: string,
  agentId?: bigint,
): string {
  return `${chainId}:${registry.toLowerCase()}${agentId === undefined ? "" : `:${agentId}`}`;
}

export function feedbackId(
  chainId: number,
  registry: string,
  agentId: bigint,
  client: string,
  index: bigint,
): string {
  return `${scopedId(chainId, registry, agentId)}:${client.toLowerCase()}:${index}`;
}

/** agentWallet metadata uses abi.encodePacked(address), not ABI's 32-byte padding. */
export function metadataWallet(value: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : ZERO;
}
