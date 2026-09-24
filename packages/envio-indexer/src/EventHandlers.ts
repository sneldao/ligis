/**
 * Event handlers for Ligis CredentialRegistry on Monad Testnet.
 *
 * Envio HyperIndex v3: register via `indexer.onEvent` (not the old
 * `Contract.Event.handler` / `generated` package exports).
 */
import { indexer } from "envio";

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
