/**
 * On-chain identity operations for Ligis.
 *
 * Single source of truth for issue / verify / revoke / rotate / sign.
 * These pure functions take a ClientContext and return plain data objects —
 * no console.log, no MCP envelope. Callers (CLI, MCP, Agent) shape the I/O.
 *
 * Consolidated from the previously duplicated implementations in
 * cli/index.ts and mcp/server.ts.
 */
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseCapability } from "@ligis/core";
import {
  CREDENTIAL_REGISTRY_ABI,
  PHAROS_AGENT_ID_ABI,
} from "./abi.js";
import { type ClientContext, requireWallet } from "./client.js";
import { parseAddress } from "./address.js";

// ---------- issue ----------

export async function issueId(
  ctx: ClientContext,
  opts: { controller?: string; tokenUri?: string }
) {
  const { walletClient, account } = requireWallet(ctx);
  const controller = opts.controller ? parseAddress(opts.controller) : account.address;
  const tokenUri = opts.tokenUri ?? "";

  const hash: Hex =
    controller.toLowerCase() === account.address.toLowerCase()
      ? await walletClient.writeContract({
          address: ctx.deployment.pharosAgentId,
          abi: PHAROS_AGENT_ID_ABI,
          functionName: "mintSelf",
          args: [tokenUri],
          chain: ctx.chain,
          account: account.address,
        })
      : await walletClient.writeContract({
          address: ctx.deployment.pharosAgentId,
          abi: PHAROS_AGENT_ID_ABI,
          functionName: "mint",
          args: [controller, tokenUri],
          chain: ctx.chain,
          account: account.address,
        });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  const tokenId = (await ctx.publicClient.readContract({
    address: ctx.deployment.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "walletOfAgent",
    args: [controller],
  })) as bigint;

  return {
    ok: true,
    action: "issue",
    controller,
    tokenId: tokenId.toString(),
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    explorer: `${ctx.network.explorerUrl}tx/${hash}`,
  };
}

// ---------- verify ----------

export async function verify(
  ctx: ClientContext,
  opts: { subject: string; capability: string; issuer?: string }
) {
  const subject = parseAddress(opts.subject);
  const capHash = parseCapability(opts.capability);

  const capable: boolean = opts.issuer
    ? ((await ctx.publicClient.readContract({
        address: ctx.deployment.credentialRegistry,
        abi: CREDENTIAL_REGISTRY_ABI,
        functionName: "isCapableFromIssuer",
        args: [subject, capHash, parseAddress(opts.issuer)],
      })) as boolean)
    : ((await ctx.publicClient.readContract({
        address: ctx.deployment.credentialRegistry,
        abi: CREDENTIAL_REGISTRY_ABI,
        functionName: "isCapable",
        args: [subject, capHash],
      })) as boolean);

  const view = (await ctx.publicClient.readContract({
    address: ctx.deployment.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "latestCredential",
    args: [subject, capHash],
  })) as { issuer: Address; issuedAt: bigint; expiresAt: bigint; revoked: boolean; valid: boolean };

  return {
    ok: true,
    action: "verify",
    subject,
    capability: opts.capability,
    capabilityHash: capHash,
    capable,
    latest: {
      issuer: view.issuer,
      issuedAt: view.issuedAt.toString(),
      expiresAt: view.expiresAt.toString(),
      revoked: view.revoked,
      valid: view.valid,
    },
    network: ctx.network.name,
    chainId: ctx.network.chainId,
  };
}

// ---------- revoke ----------

export async function revoke(
  ctx: ClientContext,
  opts: { subject: string; capability: string; nonce: string; issuerKey?: string }
) {
  const subject = parseAddress(opts.subject);
  const capHash = parseCapability(opts.capability);
  const nonce = BigInt(opts.nonce);

  let hash: Hex;
  if (opts.issuerKey) {
    const issuerAccount = privateKeyToAccount(opts.issuerKey as Hex);
    const issuerWallet = createWalletClient({
      account: issuerAccount,
      transport: http(ctx.rpc, { retryCount: 3, timeout: 20_000 }),
      chain: ctx.chain,
    });
    hash = await issuerWallet.writeContract({
      address: ctx.deployment.credentialRegistry,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: "revoke",
      args: [subject, capHash, nonce],
      chain: ctx.chain,
      account: issuerAccount.address,
    });
  } else {
    const { walletClient, account } = requireWallet(ctx);
    hash = await walletClient.writeContract({
      address: ctx.deployment.credentialRegistry,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: "revoke",
      args: [subject, capHash, nonce],
      chain: ctx.chain,
      account: account.address,
    });
  }

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  return {
    ok: true,
    action: "revoke",
    subject,
    capability: opts.capability,
    nonce: nonce.toString(),
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    explorer: `${ctx.network.explorerUrl}tx/${hash}`,
  };
}

// ---------- rotate ----------

export async function rotate(
  ctx: ClientContext,
  opts: { tokenId: string; newController: string }
) {
  const { walletClient, account } = requireWallet(ctx);
  const tokenId = BigInt(opts.tokenId);
  const newController = parseAddress(opts.newController);

  const current = (await ctx.publicClient.readContract({
    address: ctx.deployment.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as Address;

  if (current.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `caller ${account.address} is not the current controller of tokenId ${tokenId} (current: ${current})`
    );
  }

  const hash = await walletClient.writeContract({
    address: ctx.deployment.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "rotate",
    args: [tokenId, newController],
    chain: ctx.chain,
    account: account.address,
  });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  return {
    ok: true,
    action: "rotate",
    tokenId: tokenId.toString(),
    from: current,
    to: newController,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    explorer: `${ctx.network.explorerUrl}tx/${hash}`,
  };
}

// ---------- sign ----------

export async function signCredential(
  ctx: ClientContext,
  opts: {
    issuerKey: string;
    subject: string;
    capability: string;
    expiresInSeconds?: number;
  }
) {
  const issuerAccount = privateKeyToAccount(opts.issuerKey as Hex);
  const issuer = issuerAccount.address;
  const subject = parseAddress(opts.subject);
  const capHash = parseCapability(opts.capability);
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + BigInt(opts.expiresInSeconds ?? 2_592_000);

  const nonce = (await ctx.publicClient.readContract({
    address: ctx.deployment.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "issuerNonce",
    args: [issuer],
  })) as bigint;

  const digest = (await ctx.publicClient.readContract({
    address: ctx.deployment.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "hashTypedData",
    args: [issuer, subject, capHash, issuedAt, expiresAt, nonce],
  })) as Hex;

  const signature = await issuerAccount.sign({ hash: digest });

  return {
    ok: true,
    action: "sign",
    issuer,
    subject,
    capability: opts.capability,
    capabilityHash: capHash,
    issuedAt: issuedAt.toString(),
    expiresAt: expiresAt.toString(),
    nonce: nonce.toString(),
    digest,
    signature,
    submitCommand: `cast send ${
      ctx.deployment.credentialRegistry
    } "issue(address,address,bytes32,uint64,uint64,uint256,bytes)" ${issuer} ${subject} ${capHash} ${issuedAt} ${expiresAt} ${nonce} ${signature} --rpc-url ${ctx.rpc} --private-key <SUBMITTER_KEY>`,
  };
}

// ---------- getAgentId ----------

/** Read the agent ID (tokenId) for a controller wallet, or 0n if none. */
export async function getAgentId(
  ctx: ClientContext,
  controller: string
): Promise<bigint> {
  const addr = parseAddress(controller);
  return (await ctx.publicClient.readContract({
    address: ctx.deployment.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "walletOfAgent",
    args: [addr],
  })) as bigint;
}

// ---------- submitCredential ----------

/**
 * Submit a signed EIP-712 credential attestation on-chain.
 *
 * Takes the output of {@link signCredential} and broadcasts the `issue(...)`
 * transaction. Anyone can submit — the signature is the authorization.
 */
export async function submitCredential(
  ctx: ClientContext,
  signed: {
    issuer: string;
    subject: string;
    capabilityHash: Hex;
    issuedAt: string;
    expiresAt: string;
    nonce: string;
    signature: Hex;
  }
) {
  const { walletClient, account } = requireWallet(ctx);
  const issuer = parseAddress(signed.issuer);
  const subject = parseAddress(signed.subject);
  const issuedAt = BigInt(signed.issuedAt);
  const expiresAt = BigInt(signed.expiresAt);
  const nonce = BigInt(signed.nonce);

  const hash = await walletClient.writeContract({
    address: ctx.deployment.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "issue",
    args: [issuer, subject, signed.capabilityHash, issuedAt, expiresAt, nonce, signed.signature],
    chain: ctx.chain,
    account: account.address,
  });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  return {
    ok: true,
    action: "submit-credential",
    issuer,
    subject,
    capabilityHash: signed.capabilityHash,
    nonce: nonce.toString(),
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    explorer: `${ctx.network.explorerUrl}tx/${hash}`,
  };
}

// ---------- updateTokenUri ----------

/**
 * Update the off-chain metadata URI of an Agent ID.
 *
 * Used by the Trust Steward to anchor a 0G Storage root hash on-chain:
 * `updateTokenUri(ctx, { tokenId, tokenUri: \`0g://${rootHash}\` })`.
 */
export async function updateTokenUri(
  ctx: ClientContext,
  opts: { tokenId: string; tokenUri: string }
) {
  const { walletClient, account } = requireWallet(ctx);
  const tokenId = BigInt(opts.tokenId);

  const hash = await walletClient.writeContract({
    address: ctx.deployment.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "setTokenURI",
    args: [tokenId, opts.tokenUri],
    chain: ctx.chain,
    account: account.address,
  });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  return {
    ok: true,
    action: "update-token-uri",
    tokenId: tokenId.toString(),
    tokenUri: opts.tokenUri,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    explorer: `${ctx.network.explorerUrl}tx/${hash}`,
  };
}
