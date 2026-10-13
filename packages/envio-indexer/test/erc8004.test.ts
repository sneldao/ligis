import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestIndexer } from "envio";
import "../src/EventHandlers";
import {
  IDENTITY,
  REPUTATION,
  ZERO,
  scopedId,
  feedbackId,
  metadataWallet,
} from "../src/erc8004";

const OWNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const CLIENT = "0x3333333333333333333333333333333333333333";

test("packed wallet decoding and IDs preserve chain/registry scope", () => {
  assert.equal(metadataWallet(WALLET), WALLET);
  assert.equal(metadataWallet("0x"), ZERO);
  assert.equal(metadataWallet(`0x${"00".repeat(12)}${WALLET.slice(2)}`), ZERO);
  assert.notEqual(scopedId(10143, IDENTITY, 7n), scopedId(143, IDENTITY, 7n));
  assert.notEqual(
    scopedId(10143, IDENTITY, 7n),
    scopedId(10143, REPUTATION, 7n),
  );
});

test("real handlers retain wallet claims, clear transferred wallets, update URI, and revoke feedback", async () => {
  const index = createTestIndexer();
  await index.process({
    chains: {
      10143: {
        startBlock: 0,
        endBlock: 6,
        simulate: [
          {
            contract: "IdentityRegistry",
            event: "Registered",
            block: { number: 1 },
            params: {
              agentId: 424242n,
              agentURI: "ipfs://initial",
              owner: OWNER,
            },
          },
          {
            contract: "IdentityRegistry",
            event: "MetadataSet",
            block: { number: 1 },
            params: {
              agentId: 424242n,
              metadataKey: "agentWallet",
              metadataValue: OWNER,
            },
          },
          {
            contract: "IdentityRegistry",
            event: "Transfer",
            block: { number: 2 },
            params: { tokenId: 424242n, from: OWNER, to: WALLET },
          },
          {
            contract: "IdentityRegistry",
            event: "URIUpdated",
            block: { number: 3 },
            params: {
              agentId: 424242n,
              newURI: "ipfs://updated",
              updatedBy: WALLET,
            },
          },
          {
            contract: "IdentityRegistry",
            event: "MetadataSet",
            block: { number: 3 },
            params: {
              agentId: 424242n,
              metadataKey: "agentWallet",
              metadataValue: WALLET,
            },
          },
          {
            contract: "ReputationRegistry",
            event: "NewFeedback",
            block: { number: 4 },
            params: {
              agentId: 424242n,
              clientAddress: CLIENT,
              feedbackIndex: 1n,
              value: 8500n,
              valueDecimals: 2n,
              tag1: "delivery",
              tag2: "quality",
              endpoint: "https://example.invalid",
              feedbackURI: "ipfs://proof",
              feedbackHash: `0x${"ab".repeat(32)}`,
            },
          },
          {
            contract: "ReputationRegistry",
            event: "FeedbackRevoked",
            block: { number: 5 },
            params: {
              agentId: 424242n,
              clientAddress: CLIENT,
              feedbackIndex: 1n,
            },
          },
          {
            contract: "ReputationRegistry",
            event: "ResponseAppended",
            block: { number: 6 },
            params: {
              agentId: 424242n,
              clientAddress: CLIENT,
              feedbackIndex: 1n,
              responder: WALLET,
              responseURI: "ipfs://response",
              responseHash: `0x${"cd".repeat(32)}`,
            },
          },
        ],
      },
    },
  });
  const agent = await index.Erc8004Agent.getOrThrow(
    scopedId(10143, IDENTITY, 424242n),
  );
  assert.equal(agent.owner, WALLET);
  assert.equal(agent.wallet, WALLET);
  assert.equal(agent.agentURI, "ipfs://updated");
  const claims = await index.Erc8004WalletBinding.getAll();
  assert.deepEqual(claims.map((r) => r.wallet).sort(), [OWNER, WALLET]);
  const feedback = await index.Erc8004Feedback.getOrThrow(
    feedbackId(10143, REPUTATION, 424242n, CLIENT, 1n),
  );
  assert.equal(feedback.revoked, true);
  assert.equal(feedback.valueDecimals, 2);
  assert.equal(feedback.feedbackURI, "ipfs://proof");
  assert.equal((await index.Erc8004Response.getAll()).length, 1);
  assert.equal((await index.Erc8004FeedbackRevocation.getAll()).length, 1);
  const coverage = await index.Erc8004Coverage.getOrThrow(
    scopedId(10143, IDENTITY),
  );
  assert.equal(coverage.fromBlock, 0n);
  assert.equal(coverage.toBlock, 6n);
});

test("transfer without subsequent binding does not substitute NFT owner as wallet", async () => {
  const index = createTestIndexer();
  await index.process({
    chains: {
      10143: {
        startBlock: 0,
        endBlock: 2,
        simulate: [
          {
            contract: "IdentityRegistry",
            event: "Registered",
            block: { number: 1 },
            params: { agentId: 99n, agentURI: "", owner: OWNER },
          },
          {
            contract: "IdentityRegistry",
            event: "Transfer",
            block: { number: 2 },
            params: { tokenId: 99n, from: OWNER, to: WALLET },
          },
        ],
      },
    },
  });
  const agent = await index.Erc8004Agent.getOrThrow(
    scopedId(10143, IDENTITY, 99n),
  );
  assert.equal(agent.owner, WALLET);
  assert.equal(agent.wallet, ZERO);
});
