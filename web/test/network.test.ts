import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHAINS,
  chainById,
  evmNetworkKey,
  MONAD_TESTNET,
} from "../lib/network.js";

const networksFile = JSON.parse(
  readFileSync(new URL("../../assets/networks.json", import.meta.url), "utf8"),
) as {
  networks: Record<
    string,
    { chainId: number; explorerUrl: string; name: string }
  >;
  deployment: Record<
    string,
    { chainId: number; pharosAgentId: string; credentialRegistry: string }
  >;
  defaultNetwork: string;
};

/**
 * The web UI identifies chains with UI slugs (`pharos-atlantic`) while
 * assets/networks.json keys used to be different (`atlantic-testnet`). Reads
 * resolve through `evmNetwork`/`evmNetworkKey`, and getting that mapping wrong
 * silently served one chain's data under another chain's label — so it is
 * asserted here rather than left to the type system.
 */
describe("chain registry ↔ networks.json wiring", () => {
  it("resolves every EVM chain to a real deployment entry", () => {
    for (const chain of CHAINS) {
      if (chain.kind !== "evm") continue;
      const key = evmNetworkKey(chain);
      const network = networksFile.networks[key];
      const deployment = networksFile.deployment[key];
      assert.ok(
        network,
        `${chain.id} maps to networks.json key "${key}" which has no network entry`,
      );
      assert.ok(
        deployment,
        `${chain.id} maps to networks.json key "${key}" which has no recorded deployment`,
      );
      assert.equal(
        deployment.chainId,
        chain.chainId,
        `${chain.id} chainId disagrees with the ${key} deployment`,
      );
      assert.equal(network.chainId, chain.chainId);
    }
  });

  it("does not treat a stale default network as live", () => {
    assert.ok(
      networksFile.networks[networksFile.defaultNetwork],
      `defaultNetwork "${networksFile.defaultNetwork}" must exist in networks.json`,
    );
  });

  it("registers Monad Testnet as read-only", () => {
    assert.equal(MONAD_TESTNET.chainId, 10143);
    assert.equal(MONAD_TESTNET.shortName, "monad");
    assert.equal(MONAD_TESTNET.evmNetwork, "monad-testnet");
    assert.equal(MONAD_TESTNET.live, true);
    assert.equal(
      MONAD_TESTNET.writeReady,
      false,
      "browser writes are not implemented for Monad; flip this only when they are",
    );
  });

  it("resolves chains by slug and ignores unknown slugs", () => {
    assert.equal(chainById("monad-testnet")?.name, "Monad Testnet");
    assert.equal(chainById("pharos-atlantic")?.evmNetwork, "atlantic-testnet");
    assert.equal(chainById("casper-testnet")?.kind, "casper");
    assert.equal(chainById("nope"), undefined);
    assert.equal(chainById(undefined), undefined);
  });
});
