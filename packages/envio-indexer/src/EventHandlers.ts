/**
 * Event handlers for Ligis CredentialRegistry on Monad Testnet.
 *
 * Envio HyperIndex v3: register via `indexer.onEvent` (not the old
 * `Contract.Event.handler` / `generated` package exports).
 */
import { indexer } from "envio";
import {
  IDENTITY,
  REPUTATION,
  ZERO,
  scopedId,
  feedbackId,
  metadataWallet,
} from "./erc8004";

const txHashField = { transaction: ["hash"] } as const;

function rowId(block: number, logIndex: number, txHash: string): string {
  return `${block}-${logIndex}-${txHash}`;
}

indexer.onEvent(
  {
    contract: "CredentialRegistry",
    event: "CredentialIssued",
    fields: txHashField,
  },
  async ({ event, context }) => {
    const txHash = event.transaction.hash;
    context.CredentialIssued.set({
      id: rowId(event.block.number, event.logIndex, txHash),
      issuer: event.params.issuer.toLowerCase(),
      subject: event.params.subject.toLowerCase(),
      capabilityHash: event.params.capabilityHash.toLowerCase(),
      nonce: event.params.nonce,
      issuedAt: event.params.issuedAt,
      expiresAt: event.params.expiresAt,
      blockNumber: BigInt(event.block.number),
      txHash,
      logIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "IdentityRegistry", event: "Registered", fields: txHashField },
  async ({ event, context }) => {
    const { agentId, agentURI, owner } = event.params;
    context.Erc8004Agent.set({
      id: scopedId(context.chain.id, event.srcAddress, agentId),
      chainId: context.chain.id,
      registry: event.srcAddress.toLowerCase(),
      agentId,
      owner: owner.toLowerCase(),
      wallet: owner.toLowerCase(),
      agentURI,
      blockNumber: BigInt(event.block.number),
    });
  },
);

indexer.onEvent(
  { contract: "IdentityRegistry", event: "MetadataSet", fields: txHashField },
  async ({ event, context }) => {
    if (event.params.metadataKey !== "agentWallet") return;
    const { agentId, metadataValue } = event.params;
    const registry = event.srcAddress.toLowerCase();
    const wallet = metadataWallet(metadataValue);
    const id = scopedId(context.chain.id, registry, agentId);
    const previous = await context.Erc8004Agent.get(id);
    context.Erc8004WalletBinding.set({
      id: `${scopedId(context.chain.id, registry)}:${rowId(event.block.number, event.logIndex, event.transaction.hash)}`,
      chainId: context.chain.id,
      registry,
      agentId,
      wallet,
      blockNumber: BigInt(event.block.number),
      txHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
    if (previous)
      context.Erc8004Agent.set({
        ...previous,
        wallet,
        blockNumber: BigInt(event.block.number),
      });
  },
);

indexer.onEvent(
  { contract: "IdentityRegistry", event: "Transfer", fields: txHashField },
  async ({ event, context }) => {
    const id = scopedId(
      context.chain.id,
      event.srcAddress,
      event.params.tokenId,
    );
    const previous = await context.Erc8004Agent.get(id);
    // NFT ownership is NOT agentWallet. Transfers clear verified wallet metadata.
    if (previous)
      context.Erc8004Agent.set({
        ...previous,
        owner: event.params.to.toLowerCase(),
        wallet: ZERO,
        blockNumber: BigInt(event.block.number),
      });
  },
);

indexer.onEvent(
  { contract: "IdentityRegistry", event: "URIUpdated", fields: txHashField },
  async ({ event, context }) => {
    const id = scopedId(
      context.chain.id,
      event.srcAddress,
      event.params.agentId,
    );
    const previous = await context.Erc8004Agent.get(id);
    if (previous)
      context.Erc8004Agent.set({
        ...previous,
        agentURI: event.params.newURI,
        blockNumber: BigInt(event.block.number),
      });
  },
);

indexer.onEvent(
  { contract: "ReputationRegistry", event: "NewFeedback", fields: txHashField },
  async ({ event, context }) => {
    const p = event.params;
    context.Erc8004Feedback.set({
      id: feedbackId(
        context.chain.id,
        event.srcAddress,
        p.agentId,
        p.clientAddress,
        p.feedbackIndex,
      ),
      chainId: context.chain.id,
      registry: event.srcAddress.toLowerCase(),
      agentId: p.agentId,
      client: p.clientAddress.toLowerCase(),
      feedbackIndex: p.feedbackIndex,
      value: p.value,
      valueDecimals: Number(p.valueDecimals),
      tag1: p.tag1,
      tag2: p.tag2,
      endpoint: p.endpoint,
      feedbackURI: p.feedbackURI,
      feedbackHash: p.feedbackHash,
      revoked: false,
      blockNumber: BigInt(event.block.number),
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  {
    contract: "ReputationRegistry",
    event: "FeedbackRevoked",
    fields: txHashField,
  },
  async ({ event, context }) => {
    const p = event.params;
    const id = feedbackId(
      context.chain.id,
      event.srcAddress,
      p.agentId,
      p.clientAddress,
      p.feedbackIndex,
    );
    const previous = await context.Erc8004Feedback.get(id);
    context.Erc8004FeedbackRevocation.set({
      id: `${scopedId(context.chain.id, event.srcAddress)}:${rowId(event.block.number, event.logIndex, event.transaction.hash)}`,
      chainId: context.chain.id,
      registry: event.srcAddress.toLowerCase(),
      feedbackId: id,
      blockNumber: BigInt(event.block.number),
      txHash: event.transaction.hash,
    });
    if (previous) context.Erc8004Feedback.set({ ...previous, revoked: true });
  },
);

indexer.onEvent(
  {
    contract: "ReputationRegistry",
    event: "ResponseAppended",
    fields: txHashField,
  },
  async ({ event, context }) => {
    const p = event.params;
    context.Erc8004Response.set({
      id: `${scopedId(context.chain.id, event.srcAddress)}:${rowId(event.block.number, event.logIndex, event.transaction.hash)}`,
      chainId: context.chain.id,
      registry: event.srcAddress.toLowerCase(),
      feedbackId: feedbackId(
        context.chain.id,
        event.srcAddress,
        p.agentId,
        p.clientAddress,
        p.feedbackIndex,
      ),
      responder: p.responder.toLowerCase(),
      responseURI: p.responseURI,
      responseHash: p.responseHash,
      blockNumber: BigInt(event.block.number),
      txHash: event.transaction.hash,
    });
  },
);

indexer.onBlock(
  { name: "erc8004-coverage", where: ({ chain }) => chain.id === 10143 },
  async ({ block, context }) => {
    context.Erc8004Coverage.set({
      id: scopedId(context.chain.id, IDENTITY),
      chainId: context.chain.id,
      registry: IDENTITY,
      reputation: REPUTATION,
      fromBlock: 0n,
      toBlock: BigInt(block.number),
    });
  },
);

indexer.onEvent(
  {
    contract: "CredentialRegistry",
    event: "CredentialRevoked",
    fields: txHashField,
  },
  async ({ event, context }) => {
    const txHash = event.transaction.hash;
    context.CredentialRevoked.set({
      id: rowId(event.block.number, event.logIndex, txHash),
      issuer: event.params.issuer.toLowerCase(),
      subject: event.params.subject.toLowerCase(),
      capabilityHash: event.params.capabilityHash.toLowerCase(),
      nonce: event.params.nonce,
      revokedAt: event.params.revokedAt,
      blockNumber: BigInt(event.block.number),
      txHash,
      logIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  {
    contract: "CredentialRegistry",
    event: "AgentCapabilityChanged",
    fields: txHashField,
  },
  async ({ event, context }) => {
    const txHash = event.transaction.hash;
    context.AgentCapabilityChanged.set({
      id: rowId(event.block.number, event.logIndex, txHash),
      subject: event.params.subject.toLowerCase(),
      capabilityHash: event.params.capabilityHash.toLowerCase(),
      capable: event.params.capable,
      blockNumber: BigInt(event.block.number),
      txHash,
      logIndex: event.logIndex,
    });
  },
);
