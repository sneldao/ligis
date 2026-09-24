import "server-only";
import { evmNetworkKey, type ChainNetwork } from "./network";
import * as evm from "./chain";
import * as casper from "./chain-casper";

export type {
  CapabilityRef,
  CredentialView,
  HeldCredential,
  AgentSnapshot,
  IssuerActivity,
  IssuanceLog,
  CapabilityChange,
} from "./chain";
export type { Hex } from "./chain-casper";
export { capabilities } from "./chain";

export function isCasperChain(chain: ChainNetwork): boolean {
  return chain.kind === "casper";
}

export async function readAgentId(
  chain: ChainNetwork,
  address: string,
): Promise<bigint> {
  if (isCasperChain(chain)) {
    return casper.readAgentId(address);
  }
  return evm.readAgentId(address as `0x${string}`, evmNetworkKey(chain));
}

export async function readBlockNumber(chain: ChainNetwork): Promise<bigint> {
  if (isCasperChain(chain)) {
    return casper.readBlockNumber();
  }
  return evm.readBlockNumber(evmNetworkKey(chain));
}

export async function readTotalSupply(chain: ChainNetwork): Promise<bigint> {
  if (isCasperChain(chain)) {
    return casper.readTotalSupply();
  }
  return evm.readTotalSupply(evmNetworkKey(chain));
}

export async function readOwnerOf(
  tokenId: bigint,
  networkId: string,
): Promise<`0x${string}`> {
  return evm.readOwnerOf(tokenId, networkId);
}

export async function isCapable(
  chain: ChainNetwork,
  subject: string,
  capabilityHash: `0x${string}`,
): Promise<boolean> {
  if (isCasperChain(chain)) {
    return casper.isCapable(subject, capabilityHash);
  }
  return evm.isCapable(
    subject as `0x${string}`,
    capabilityHash,
    evmNetworkKey(chain),
  );
}

export async function isCapableMulti(
  chain: ChainNetwork,
  subject: string,
  capabilityHashes: readonly `0x${string}`[],
): Promise<boolean[]> {
  if (isCasperChain(chain)) {
    return casper.isCapableMulti(subject, capabilityHashes);
  }
  return evm.isCapableMulti(
    subject as `0x${string}`,
    capabilityHashes,
    evmNetworkKey(chain),
  );
}

export async function readCredential(
  chain: ChainNetwork,
  subject: string,
  capabilityHash: `0x${string}`,
) {
  if (isCasperChain(chain)) {
    return casper.readCredential(subject, capabilityHash);
  }
  return evm.readCredential(
    subject as `0x${string}`,
    capabilityHash,
    evmNetworkKey(chain),
  );
}

export async function readAgentSnapshot(chain: ChainNetwork, address: string) {
  if (isCasperChain(chain)) {
    return casper.readAgentSnapshot(address);
  }
  return evm.readAgentSnapshot(address as `0x${string}`, evmNetworkKey(chain));
}

export async function readIssuerActivity(chain: ChainNetwork) {
  if (isCasperChain(chain)) {
    return casper.readIssuerActivity();
  }
  return evm.readIssuerActivity(evmNetworkKey(chain));
}

export async function readCapabilityHistory(
  chain: ChainNetwork,
  subject: string,
  opts?: { fromBlock?: bigint; toBlock?: bigint },
) {
  if (isCasperChain(chain)) {
    return casper.readCapabilityHistory(subject, opts);
  }
  return evm.readCapabilityHistory(subject as `0x${string}`, {
    ...opts,
    networkId: evmNetworkKey(chain),
  });
}

/**
 * The contract addresses the selected chain actually reads from. Editorial
 * surfaces must use this rather than the Pharos-bound legacy export.
 */
export function readDeployment(chain: ChainNetwork): {
  agentIdContract: string;
  credentialRegistry: string;
} {
  if (isCasperChain(chain)) {
    return {
      agentIdContract: process.env.LIGIS_CASPER_AGENT_ID ?? "not configured",
      credentialRegistry:
        process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY ?? "not configured",
    };
  }
  const ctx = evm.getEvmReadContext(evmNetworkKey(chain));
  return {
    agentIdContract: ctx.addresses.pharosAgentId,
    credentialRegistry: ctx.addresses.credentialRegistry,
  };
}

export function isValidAddress(chain: ChainNetwork, value: string): boolean {
  if (isCasperChain(chain)) {
    return casper.isCasperAddress(value);
  }
  // EVM address check
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
