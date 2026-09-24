import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { defaultServices } from "../src/provider.js";
import {
  SERVICE_ID,
  SERVICE_PRICE_USD,
  SUPPORTED_SERVICES,
} from "../src/services.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface StoreManifest {
  services: Array<{ id: string; name: string; priceUsd: string }>;
}

const manifest = JSON.parse(
  readFileSync(join(__dirname, "../croo-store-manifest.json"), "utf8"),
) as StoreManifest;

/**
 * Three places describe the same service catalog: `SERVICE_ID` /
 * `SERVICE_PRICE_USD` in code, the provider descriptors sent to buyers, and
 * `croo-store-manifest.json` used to register the listings. They drifted apart
 * once already (a hint quoted $1.00 for a $2.00 listing), and the buyer sees the
 * mismatch — so they are checked against each other here.
 */
describe("service catalog consistency", () => {
  it("lists exactly the supported services in the manifest", () => {
    const manifestIds = manifest.services.map((s) => s.id).sort();
    assert.deepStrictEqual(
      manifestIds,
      [...SUPPORTED_SERVICES].sort(),
      "croo-store-manifest.json must describe exactly the supported services",
    );
  });

  it("prices every service identically in code, descriptors, and manifest", () => {
    for (const id of SUPPORTED_SERVICES) {
      const expected = SERVICE_PRICE_USD[id];

      const descriptor = defaultServices.find((s) => s.id === id);
      assert.ok(descriptor, `missing provider descriptor for ${id}`);

      const listed = manifest.services.find((s) => s.id === id);
      assert.ok(listed, `missing manifest entry for ${id}`);

      assert.strictEqual(
        descriptor.priceUsd,
        expected,
        `${id} descriptor price drifted from SERVICE_PRICE_USD`,
      );
      assert.strictEqual(
        listed.priceUsd,
        expected,
        `${id} manifest price drifted from SERVICE_PRICE_USD`,
      );
    }
  });

  it("keeps the one-order bundle cheaper than buying its parts", () => {
    const bundle = Number(SERVICE_PRICE_USD[SERVICE_ID.qualify]);
    const parts =
      Number(SERVICE_PRICE_USD[SERVICE_ID.risk]) +
      Number(SERVICE_PRICE_USD[SERVICE_ID.issue]);
    assert.ok(
      bundle < parts,
      `ligis.qualify ($${bundle}) must undercut ligis.risk + ligis.issue ($${parts})`,
    );
  });

  it("exposes a handler for every supported service", () => {
    for (const id of SUPPORTED_SERVICES) {
      const descriptor = defaultServices.find((s) => s.id === id);
      assert.ok(descriptor, `missing provider descriptor for ${id}`);
      assert.strictEqual(typeof descriptor.handler, "function");
    }
  });
});
