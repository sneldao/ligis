/**
 * Casper Testnet deployment config — public read.
 *
 * Returns the Casper chain name, RPC URL, and the deployed contract
 * package hashes so the **browser** wallet flow can construct
 * TransactionV1 calls without mirroring server-only env vars to
 * `NEXT_PUBLIC_*` at build time. The contract addresses are public on
 * cspr.live so this is not a credential; no auth required, all users
 * who hit the Casper Testnet on-chain data need these.
 *
 * Cached for 5 minutes — the package hashes don't move between deploys,
 * and the explorer-routed RPC URL only changes when we switch providers.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 300;

export function GET(): Response {
  return NextResponse.json(
    {
      chainName: "casper-test",
      rpcUrl: "https://node.testnet.casper.network/rpc",
      explorerUrl: "https://testnet.cspr.live",
      agentIdPackageHash:
        process.env.LIGIS_CASPER_AGENT_ID?.replace(/^contract-package-/, "").replace(/^hash-/, "").replace(/^0x/, "") ??
        null,
      credentialRegistryPackageHash:
        process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY?.replace(/^contract-package-/, "").replace(/^hash-/, "").replace(/^0x/, "") ??
        null,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Ligis-Proxy": "casper-config-public-read",
      },
    },
  );
}
