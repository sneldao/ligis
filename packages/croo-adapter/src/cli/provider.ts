#!/usr/bin/env node
import { AgentClient } from "@croo-network/sdk";
import { LigisCrooProvider, defaultServices } from "../provider.js";
import { loadCrooConfig } from "../config.js";
import { createCrooClient } from "../client.js";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Build a map of CROO listing UUIDs -> Ligis service names from env vars.
 * CROO sends the listing UUID as `service_id` in negotiation events, but
 * the provider matches by service name. Env var format:
 *   CROO_SERVICE_ID_LIGIS_RISK=<uuid>
 *   CROO_SERVICE_ID_LIGIS_VERIFY=<uuid>
 *   CROO_SERVICE_ID_LIGIS_ISSUE=<uuid>
 *
 * Also checks the legacy CROO_TARGET_SERVICE_ID (single service, treated
 * as a UUID that maps to "ligis.verify" for backwards compatibility).
 */
function loadServiceAliases(): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const service of defaultServices) {
    const envKey = `CROO_SERVICE_ID_${service.id.toUpperCase().replace(/\./g, "_")}`;
    const uuid = process.env[envKey];
    if (uuid) {
      aliases.set(uuid, service.id);
    }
  }
  // Legacy: CROO_TARGET_SERVICE_ID was the old single-service env var.
  // If it looks like a UUID (contains dashes), treat it as an alias for ligis.verify.
  const legacy = process.env.CROO_TARGET_SERVICE_ID;
  if (legacy && legacy.includes("-") && !aliases.has(legacy)) {
    aliases.set(legacy, "ligis.verify");
  }
  return aliases;
}

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

  const serviceAliases = loadServiceAliases();

  const provider = new LigisCrooProvider({
    client: sdkClient,
    services: defaultServices,
    idempotencyDbPath: dbPath,
    serviceIdAliases: serviceAliases,
  });
  const stream = await provider.start();

  console.log("[ligis-croo] Provider started. Waiting for CROO negotiations...");
  console.log(
    `[ligis-croo] Services: ${defaultServices.map((s) => s.id).join(", ")}`,
  );
  if (serviceAliases.size > 0) {
    for (const [uuid, name] of serviceAliases) {
      console.log(`[ligis-croo] Service alias: ${uuid} -> ${name}`);
    }
  } else {
    console.log("[ligis-croo] No service aliases configured (set CROO_SERVICE_ID_* env vars)");
  }
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
