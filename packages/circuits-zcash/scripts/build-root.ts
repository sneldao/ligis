/**
 * Build a publishable registry root manifest.
 *
 *   # demo fixture (deterministic events + signed registrations):
 *   pnpm --filter @ligis/circuits-zcash build-root -- --demo --out manifest.json
 *   # from a JSON export: { events: RegistryEvent[] }
 *   pnpm --filter @ligis/circuits-zcash build-root -- --events ev.json \
 *     --registrations regs.json --out manifest.json
 *   # read-only from chain (eth_getLogs; no keys, no transactions):
 *   pnpm --filter @ligis/circuits-zcash build-root -- --rpc <url> \
 *     --registry 0x… --from-block N --registrations regs.json --out manifest.json
 *
 * `--as-of <unix>` (default now) drops credentials expired at that time.
 * Point the gate at the output with LIGIS_ZK_ROOT_MANIFEST.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient, http, type Hex } from "viem";
import { demoRegistry } from "../src/demo-registry.js";
import {
  buildRegistryRoot,
  fetchRegistryEvents,
  type RegistryEvent,
  type SubjectRegistration,
} from "../src/registry.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    demo: { type: "boolean", default: false },
    events: { type: "string" },
    rpc: { type: "string" },
    registry: { type: "string" },
    "from-block": { type: "string", default: "0" },
    "to-block": { type: "string" },
    registrations: { type: "string" },
    "as-of": { type: "string" },
    out: { type: "string" },
  },
});

// `pnpm --filter … build-root` runs in the package dir; resolve user paths
// against where the command was typed.
const userPath = (p: string) =>
  resolve(process.env.INIT_CWD ?? process.cwd(), p);
const asOf = Number(values["as-of"] ?? Math.floor(Date.now() / 1000));
const readJson = <T>(p: string): T =>
  JSON.parse(readFileSync(userPath(p), "utf8")) as T;

let result;
if (values.demo) {
  result = await demoRegistry(asOf);
} else {
  const registrations = values.registrations
    ? readJson<SubjectRegistration[]>(values.registrations)
    : [];
  if (values.events) {
    const { events } = readJson<{ events: RegistryEvent[] }>(values.events);
    result = await buildRegistryRoot({
      events,
      registrations,
      asOf,
      source: { kind: "fixture", name: values.events },
    });
  } else if (values.rpc && values.registry) {
    const client = createPublicClient({ transport: http(values.rpc) });
    const chainId = await client.getChainId();
    const { events, toBlock } = await fetchRegistryEvents(
      client,
      values.registry as Hex,
      BigInt(values["from-block"]!),
      values["to-block"] ? BigInt(values["to-block"]) : undefined,
    );
    result = await buildRegistryRoot({
      events,
      registrations,
      asOf,
      source: {
        kind: "chain",
        chainId,
        registry: values.registry as Hex,
        fromBlock: values["from-block"]!,
        toBlock: toBlock.toString(),
      },
    });
  } else {
    console.error("need --demo, --events, or --rpc + --registry");
    process.exit(1);
  }
}

const json = `${JSON.stringify(result.manifest, null, 2)}\n`;
if (values.out) writeFileSync(userPath(values.out), json);
else process.stdout.write(json);
const m = result.manifest;
console.error(
  `root ${m.root} · ${m.leafCount} leaves · skipped ${JSON.stringify(m.skipped)}${values.out ? ` → ${values.out}` : ""}`,
);
