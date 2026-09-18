import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import type { LoadedConfig, NetworksFile } from "@ligis/core";
import { buildClientContext } from "../src/client.js";

const networksFile: NetworksFile = JSON.parse(
  readFileSync(
    new URL("../../../assets/networks.json", import.meta.url),
    "utf8",
  ),
);

it("configures Monad testnet without changing the default network", () => {
  const network = networksFile.networks["monad-testnet"];
  assert.equal(network.chainId, 10143);
  assert.equal(network.rpcUrl, "https://testnet-rpc.monad.xyz");
  assert.equal(network.explorerUrl, "https://testnet.monadscan.com");
  assert.deepEqual(network.nativeToken, {
    symbol: "MON",
    name: "Monad",
    decimals: 18,
  });
  assert.equal(networksFile.defaultNetwork, "atlantic-testnet");
});

it("builds a Monad client through the existing EVM adapter", (t) => {
  for (const key of ["PRIVATE_KEY", "LIGIS_RPC_URL", "PHAROS_RPC_URL"]) {
    const previous = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  // Test-only addresses: no Monad deployment is recorded or contacted here.
  const config: LoadedConfig = {
    rootDir: new URL("../../../", import.meta.url).pathname,
    networksFile,
    networkName: "monad-testnet",
    network: networksFile.networks["monad-testnet"],
    deployment: {
      pharosAgentId: "0x1111111111111111111111111111111111111111",
      credentialRegistry: "0x2222222222222222222222222222222222222222",
      deployer: "0x3333333333333333333333333333333333333333",
      chainId: 10143,
      deployedAt: "0",
    },
  };
  const ctx = buildClientContext(config);
  assert.equal(ctx.chain.id, 10143);
  assert.equal(ctx.chain.nativeCurrency.symbol, "MON");
  assert.equal(ctx.rpc, config.network.rpcUrl);
  assert.equal(ctx.deployment.chainId, 10143);
  assert.equal(ctx.walletClient, null);
});
