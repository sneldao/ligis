/**
 * viem client bootstrap for the EVM adapter.
 *
 * Internal to @ligis/adapter-evm. Builds public/wallet clients from a
 * LoadedConfig (which the adapter factory pulls from @ligis/core).
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { LoadedConfig, Network } from "@ligis/core";

export interface DeploymentAddresses {
  pharosAgentId: Address;
  credentialRegistry: Address;
  chainId: number;
  deployer: Address;
  deployedAt: string;
}

export interface ClientContext {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient> | null;
  account: ReturnType<typeof privateKeyToAccount> | null;
  network: Network;
  networkName: string;
  /** EVM-typed deployment addresses (validated at the adapter boundary). */
  deployment: DeploymentAddresses;
  rpc: string;
  chain: ReturnType<typeof defineChain>;
}

/**
 * Build a ClientContext from a LoadedConfig + environment.
 *
 * Honors `LIGIS_RPC_URL` / `PHAROS_RPC_URL` (env overrides) and `PRIVATE_KEY`
 * for the signing wallet. Transports include retry/timeout for resilience.
 */
export function buildClientContext(loaded: LoadedConfig): ClientContext {
  const { networkName, network, deployment } = loaded;
  const rpc =
    process.env.LIGIS_RPC_URL || process.env.PHAROS_RPC_URL || network.rpcUrl;
  const transport = http(rpc, { retryCount: 3, timeout: 20_000 });
  const publicClient = createPublicClient({ transport });
  const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
  const account = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY) : null;
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: network.nativeToken,
    rpcUrls: { default: { http: [rpc] } },
  });
  const walletClient = account
    ? createWalletClient({ account, transport, chain })
    : null;
  const deploymentAddresses: DeploymentAddresses = {
    pharosAgentId: deployment.pharosAgentId as Address,
    credentialRegistry: deployment.credentialRegistry as Address,
    chainId: deployment.chainId,
    deployer: deployment.deployer as Address,
    deployedAt: deployment.deployedAt,
  };
  return {
    publicClient,
    walletClient,
    account,
    network,
    networkName,
    deployment: deploymentAddresses,
    rpc,
    chain,
  };
}

/** Assert that a wallet is configured and return it. */
export function requireWallet(ctx: ClientContext): {
  walletClient: NonNullable<ClientContext["walletClient"]>;
  account: NonNullable<ClientContext["account"]>;
} {
  if (!ctx.walletClient || !ctx.account) {
    throw new Error(
      "PRIVATE_KEY is not set. Set it in the environment to use write operations.",
    );
  }
  return { walletClient: ctx.walletClient, account: ctx.account };
}
