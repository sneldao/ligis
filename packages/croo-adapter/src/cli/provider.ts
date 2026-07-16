#!/usr/bin/env node
import { AgentClient } from "@croo-network/sdk";
import { LigisCrooProvider, defaultServices } from "../provider.js";
import { loadCrooConfig } from "../config.js";
import { createCrooClient } from "../client.js";
import { join } from "node:path";
import { homedir } from "node:os";

async function main() {
  const config = loadCrooConfig();
  const sdkClient = createCrooClient(
    {
      baseURL: config.apiURL,
      wsURL: config.wsURL,
    },
    config.sdkKey,
  );

  // Persistent idempotency: survive restarts without double-delivering.
  // Default location is ~/.ligis/croo-idempotency.db, overridable via env.
  const dbPath = process.env.LIGIS_CROO_IDEMPOTENCY_DB ??
    join(homedir(), ".ligis", "croo-idempotency.db");

  const provider = new LigisCrooProvider({
    client: sdkClient,
    services: defaultServices,
    idempotencyDbPath: dbPath,
  });
  const stream = await provider.start();

  console.log("[ligis-croo] Provider started. Waiting for CROO negotiations...");
  console.log(
    `[ligis-croo] Services: ${defaultServices.map((s) => s.id).join(", ")}`,
  );
  console.log(`[ligis-croo] Idempotency DB: ${dbPath}`);
  console.log(`[ligis-croo] Chain: ${config.ligisChain}`);

  process.on("SIGINT", () => {
    console.log("[ligis-croo] Shutting down...");
    stream.close?.();
    provider.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[ligis-croo] Fatal error:", err);
  process.exit(1);
});
