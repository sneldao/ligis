#!/usr/bin/env tsx
/**
 * Smoke-test ENVIO_API_TOKEN against Monad Testnet HyperSync (no Docker).
 *
 *   set -a && source .env.d/envio.env && set +a
 *   pnpm --filter @ligis/envio-indexer smoke:hypersync
 */
const TOKEN = process.env.ENVIO_API_TOKEN?.trim();
if (!TOKEN) {
  console.error("ENVIO_API_TOKEN is not set (source .env.d/envio.env).");
  process.exit(1);
}

const REGISTRY = "0x698e1c05d34e2b6d0b6ecd71f3fc9e84e64733c5";
const START = 63_359_413; // AgentId deploy block

async function main(): Promise<void> {
  const heightRes = await fetch("https://monad-testnet.hypersync.xyz/height", {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!heightRes.ok) {
    console.error("height failed", heightRes.status, await heightRes.text());
    process.exit(1);
  }
  const heightBody = (await heightRes.json()) as { height?: number };
  console.log("HyperSync height", heightBody.height);

  const queryRes = await fetch("https://monad-testnet.hypersync.xyz/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      from_block: START,
      logs: [{ address: [REGISTRY] }],
      field_selection: {
        log: [
          "address",
          "topic0",
          "block_number",
          "transaction_hash",
          "log_index",
        ],
      },
      max_num_logs: 5,
    }),
  });
  if (!queryRes.ok) {
    console.error("query failed", queryRes.status, await queryRes.text());
    process.exit(1);
  }
  const body = (await queryRes.json()) as {
    data?: Array<{ logs?: unknown[] }>;
    next_block?: number;
    archive_height?: number;
  };
  const n = (body.data ?? []).reduce(
    (acc, b) => acc + (b.logs?.length ?? 0),
    0,
  );
  console.log("registry logs (first page)", n);
  console.log(
    "next_block",
    body.next_block,
    "archive_height",
    body.archive_height,
  );
  if (n === 0) {
    console.error("expected at least one CredentialRegistry log after deploy");
    process.exit(1);
  }
  console.log("OK — ENVIO_API_TOKEN works for Monad Testnet HyperSync");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
