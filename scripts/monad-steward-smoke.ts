#!/usr/bin/env tsx
/**
 * Live steward smoke on Monad Testnet — reuses the funded deployer key.
 *
 *   set -a && source .env.d/deployer.env && source .env.d/steward.env && set +a
 *   export LIGIS_STEWARD_KEY="${LIGIS_STEWARD_KEY:-$PHAROS_DEPLOYER_KEY}"
 *   npx tsx --import ./scripts/stub-server-only.mjs scripts/monad-steward-smoke.ts
 */
if (!process.env.LIGIS_STEWARD_KEY && process.env.PHAROS_DEPLOYER_KEY) {
  process.env.LIGIS_STEWARD_KEY = process.env.PHAROS_DEPLOYER_KEY;
}

const { stewardLoop } = await import("../web/lib/steward.ts");

console.log("Monad steward smoke — live writes on monad-testnet\n");

for await (const ev of stewardLoop("Qualify for escrow commerce on Monad", {
  live: true,
  clientIp: "local-smoke",
  networkId: "monad-testnet",
})) {
  switch (ev.type) {
    case "phase":
      console.log(`phase  ${ev.phase} ${ev.status}`);
      break;
    case "boot":
      console.log(
        `boot   token=#${ev.tokenId} subject=${ev.subject} minted=${ev.minted}`,
      );
      break;
    case "capability":
      console.log(
        `cap    ${ev.name} ${ev.capable ? "GO" : "STOP"}${ev.selfIssued ? " (issued)" : ""}${
          ev.issueTxHash ? ` ${ev.issueTxHash}` : ""
        }`,
      );
      break;
    case "tx":
      console.log(`tx     ${ev.txHash}`);
      break;
    case "manifest":
      console.log(`anchor ${ev.anchorTx}`);
      break;
    case "summary":
      console.log("\nsummary", {
        ok: ev.ok,
        gated: ev.gated,
        live: ev.live,
        rpcCalls: ev.rpcCalls,
        subject: ev.subject,
      });
      break;
    case "error":
      console.error("ERROR", ev.message);
      process.exitCode = 1;
      break;
    default:
      break;
  }
}
