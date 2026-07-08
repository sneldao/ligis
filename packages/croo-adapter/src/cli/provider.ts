#!/usr/bin/env node
import { AgentClient } from "@croo-network/sdk";
import { LigisCrooProvider, defaultServices } from "../provider.js";
import { loadCrooConfig } from "../config.js";
import { createCrooClient } from "../client.js";

async function main() {
  const config = loadCrooConfig();
  const sdkClient = createCrooClient(
    {
      baseURL: config.apiURL,
      wsURL: config.wsURL,
    },
    config.sdkKey,
  );

  const provider = new LigisCrooProvider({
    client: sdkClient,
    services: defaultServices,
  });
  const stream = await provider.start();

  console.log(
    "[ligis-croo] Provider started. Waiting for CROO negotiations...",
  );
  console.log(
    `[ligis-croo] Services: ${defaultServices.map((s) => s.id).join(", ")}`,
  );

  process.on("SIGINT", () => {
    console.log("[ligis-croo] Shutting down...");
    stream.close?.();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[ligis-croo] Fatal error:", err);
  process.exit(1);
});
