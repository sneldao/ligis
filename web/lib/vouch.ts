import "server-only";
import {
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CREDENTIAL_REGISTRY_ABI } from "@ligis/adapter-evm";
import { getEvmReadContext } from "./chain";
import { evmNetworkKey, type ChainNetwork } from "./network";

/**
 * The issuer desk: the steward/demo key acts as the vouching issuer on the
 * EVM registries. Same EIP-712 issue flow as web/lib/steward.ts, and a
 * revoke path that scans the issuer's recent nonces for its live credential.
 *
 * In production the issuer is the business's own key — this module exists so
 * the supply side of the gate is demonstrable end-to-end.
 */

function vouchAccount() {
  const raw =
    process.env.LIGIS_STEWARD_KEY ||
    process.env.PRIVATE_KEY ||
    process.env.PHAROS_DEPLOYER_KEY;
  if (!raw) return null;
  return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
}

export function vouchIssuer(): Address | null {
  return vouchAccount()?.address ?? null;
}

/** Sign + broadcast via sendRawTransaction (some RPCs reject eth_sendTransaction). */
async function send(
  chain: ChainNetwork,
  params: {
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  },
): Promise<Hex> {
  const ctx = getEvmReadContext(evmNetworkKey(chain));
  const account = vouchAccount();
  if (!account) {
    throw new Error("No issuer key configured (LIGIS_STEWARD_KEY).");
  }
  const wallet = createWalletClient({
    account,
    chain: ctx.chain,
    transport: http(ctx.rpcUrl, { retryCount: 3, timeout: 20_000 }),
  });
  const data = encodeFunctionData({
    abi: params.abi as any,
    functionName: params.functionName,
    args: params.args as any,
  });
  const estimated = await ctx.client
    .estimateGas({
      account: account.address,
      to: ctx.addresses.credentialRegistry,
      data,
    })
    .catch(() => 300_000n);
  const gas = (estimated * 110n) / 100n;
  const nonce = await ctx.client.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const gasPrice = await ctx.client.getGasPrice();
  let maxFeePerGas = gasPrice;
  let maxPriorityFeePerGas = gasPrice / 10n;
  try {
    const fees = await ctx.client.estimateFeesPerGas();
    if (fees.maxFeePerGas != null) maxFeePerGas = fees.maxFeePerGas;
    if (fees.maxPriorityFeePerGas != null) {
      maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    }
  } catch {
    // keep gasPrice-derived fees
  }
  const serialized = await account.signTransaction({
    chainId: ctx.chain.id,
    to: ctx.addresses.credentialRegistry,
    data,
    gas,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const hash = await ctx.client.sendRawTransaction({
    serializedTransaction: serialized,
  });
  await ctx.client.waitForTransactionReceipt({ hash });
  return hash;
}

export function vouchCapabilityHash(id: string): Hex {
  return keccak256(toBytes(id)) as Hex;
}

/**
 * Issue a credential to `subject` for `capabilityId`, signed by the steward
 * issuer key (EIP-712). Returns the tx hash and the nonce used.
 */
export async function vouchIssue(args: {
  chain: ChainNetwork;
  subject: Address;
  capabilityId: string;
  expiryDays?: number;
}): Promise<{ tx: Hex; nonce: bigint }> {
  const ctx = getEvmReadContext(evmNetworkKey(args.chain));
  const account = vouchAccount();
  if (!account)
    throw new Error("No issuer key configured (LIGIS_STEWARD_KEY).");

  const issuer = account.address;
  const capHash = vouchCapabilityHash(args.capabilityId);
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + BigInt(args.expiryDays ?? 30) * 86400n;

  const nonce = (await ctx.client.readContract({
    address: ctx.addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "issuerNonce",
    args: [issuer],
  })) as bigint;

  const digest = (await ctx.client.readContract({
    address: ctx.addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "hashTypedData",
    args: [issuer, args.subject, capHash, issuedAt, expiresAt, nonce],
  })) as Hex;

  const signature = await account.sign({ hash: digest });

  const tx = await send(args.chain, {
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "issue",
    args: [
      issuer,
      args.subject,
      capHash,
      issuedAt,
      expiresAt,
      nonce,
      signature,
    ],
  });
  return { tx, nonce };
}

/**
 * Revoke every live credential the steward issuer holds on
 * (subject, capability) — the gate stays open while any issuer vouches, so
 * a demo revoke must clear them all.
 */
export async function vouchRevoke(args: {
  chain: ChainNetwork;
  subject: Address;
  capabilityId: string;
}): Promise<{ txs: Hex[]; revoked: number }> {
  const ctx = getEvmReadContext(evmNetworkKey(args.chain));
  const account = vouchAccount();
  if (!account)
    throw new Error("No issuer key configured (LIGIS_STEWARD_KEY).");

  const issuer = account.address;
  const capHash = vouchCapabilityHash(args.capabilityId);

  const next = (await ctx.client.readContract({
    address: ctx.addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "issuerNonce",
    args: [issuer],
  })) as bigint;

  const txs: Hex[] = [];
  const start = next > 0n ? next - 1n : -1n;
  const floor = start > 49n ? start - 50n : 0n;
  for (let n = start; n >= floor && n >= 0n; n--) {
    const view = (await ctx.client
      .readContract({
        address: ctx.addresses.credentialRegistry,
        abi: CREDENTIAL_REGISTRY_ABI,
        functionName: "getCredential",
        args: [args.subject, capHash, n],
      })
      .catch(() => null)) as {
      issuer?: Address;
      revoked?: boolean;
      valid?: boolean;
    } | null;
    if (!view?.issuer || view.issuer.toLowerCase() !== issuer.toLowerCase())
      continue;
    if (view.revoked || view.valid === false) continue;
    txs.push(
      await send(args.chain, {
        abi: CREDENTIAL_REGISTRY_ABI,
        functionName: "revoke",
        args: [args.subject, capHash, n],
      }),
    );
  }
  return { txs, revoked: txs.length };
}
