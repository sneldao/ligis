import { loadZeroGConfig, setupProvider } from "../packages/zerog/src/compute.js";

async function main() {
  const config = loadZeroGConfig();
  console.log("RPC:", config.rpcUrl);
  console.log("Provider:", config.provider);
  console.log("Running setupProvider()...");
  await setupProvider(config);
  console.log("setupProvider() complete!");
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
