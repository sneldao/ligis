#!/usr/bin/env node
/**
 * Derive Casper wallet public addresses (pubkey, EVM address, account-hash)
 * from the private keys in .env.d/casper.env. Prints ONLY the public values
 * (no private keys are echoed). Run after rotating a key to refresh the
 * cached derived addresses that other tooling relies on.
 *
 * Usage:
 *   npx tsx scripts/derive-casper-wallet.ts                  # print all three
 *   npx tsx scripts/derive-casper-wallet.ts deployer         # print one
 *   npx tsx scripts/derive-casper-wallet.ts --write          # also append to .env.d/casper.env
 *   npx tsx scripts/derive-casper-wallet.ts --write server   # write to ~/.env via SSH
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import sdk from "casper-js-sdk";

const { PrivateKey, KeyAlgorithm, PublicKey } = sdk;

type Derived = {
  label: string;
  pubkey: string; // Casper 1.x SECP256K1: 01 + 02|03 + X (34 bytes)
  ethAddress: string;
  accountHash: string; // Casper 2.0 account-hash (NOT legacy blake2b over uncompressed pubkey)
};

function deriveFromHex(hexRaw: string): Omit<Derived, "label"> {
  const hex = hexRaw.replace(/^0x/, "").replace(/[*]/g, "").trim();
  if (hex.length !== 64) {
    throw new Error(`Private key must be 64 hex chars, got ${hex.length}`);
  }
  // 1. Use the SDK for the canonical Casper pubkey + account-hash.
  //    The SDK's `accountHash()` implements the Casper 2.0 algorithm;
  //    raw blake2b(uncompressed X||Y) produces a legacy 1.x hash that
  //    does not exist on the testnet global state.
  const pk = PrivateKey.fromHex(hex, KeyAlgorithm.SECP256K1);
  const sdkPub = PublicKey.fromHex(pk.publicKey.toHex());
  // 2. Use noble only for the EVM address (keccak of uncompressed X||Y).
  const scalar = BigInt("0x" + hex);
  const u = secp256k1.getPublicKey(scalar, false);
  const ethBytes = keccak_256(u.slice(1)).slice(-20);
  return {
    pubkey: pk.publicKey.toHex(),
    ethAddress: "0x" + bytesToHex(Array.from(ethBytes)),
    accountHash: "account-hash-" + sdkPub.accountHash().toHex(),
  };
}

function bytesToHex(bytes: number[]): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function loadEnv(file: string): Record<string, string> {
  if (!existsSync(file)) throw new Error(`Env file not found: ${file}`);
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function formatDerived(d: Derived): string {
  return [
    `${d.label}:`,
    `  pubkey:       ${d.pubkey}`,
    `  eth_address:  ${d.ethAddress}`,
    `  account_hash: ${d.accountHash}`,
  ].join("\n");
}

function appendToEnv(file: string, derived: Derived[]): void {
  const existing = readFileSync(file, "utf-8");
  // Remove any prior derived block we wrote.
  const marker = "# Derived addresses (computed from _PRIVATE_KEY)";
  const idx = existing.indexOf(marker);
  const base = idx >= 0 ? existing.slice(0, idx).trimEnd() + "\n\n" : existing.trimEnd() + "\n\n";
  const block =
    `${marker}\n` +
    `# safe to share, used for funding, on-chain lookups, and cross-chain verification.\n` +
    `# Re-run \`npx tsx scripts/derive-casper-wallet.ts --write\` after rotating keys.\n` +
    derived
      .map((d) => {
        const name = d.label.replace("LIGIS_CASPER_", "").toLowerCase();
        return [
          `LIGIS_CASPER_${name.toUpperCase()}_EVM_ADDRESS=${d.ethAddress}`,
          `LIGIS_CASPER_${name.toUpperCase()}_ACCOUNT_HASH=${d.accountHash}`,
        ].join("\n");
      })
      .join("\n") +
    "\n";
  writeFileSync(file, base + block);
  console.log(`Updated ${file}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const toServer = args.includes("server");
  const positional = args.filter((a) => !a.startsWith("--") && a !== "server");
  const filter = positional[0];
  const envFile = process.env.CASPER_ENV_FILE ?? ".env.d/casper.env";

  const env = loadEnv(envFile);
  const labels = ["LIGIS_CASPER_DEPLOYER", "LIGIS_CASPER_AGENT", "LIGIS_CASPER_ISSUER"];
  const derived: Derived[] = [];
  for (const label of labels) {
    const pkKey = `${label}_PRIVATE_KEY`;
    const pk = env[pkKey];
    if (!pk || pk.replace(/[*]/g, "") === "") {
      console.warn(`Skipping ${label}: ${pkKey} not set or empty`);
      continue;
    }
    const d = deriveFromHex(pk);
    derived.push({ label, ...d });
  }

  if (filter) {
    const match = derived.find(
      (d) => d.label.toLowerCase().endsWith(filter.toLowerCase())
    );
    if (!match) throw new Error(`No wallet matching ${filter}`);
    console.log(formatDerived(match));
    return;
  }

  for (const d of derived) console.log(formatDerived(d) + "\n");

  if (write) {
    appendToEnv(envFile, derived);
    if (toServer) {
      const remote = process.env.SERVER_ENV_PATH ?? "/opt/ligis-croo/.env";
      const block = buildRemoteBlock(derived);
      const sshTarget = process.env.SERVER_HOST ?? "nuncio-vultr";
      // Pipe the block via stdin so we never write the secret to a temp file
      // on the remote host. The block contains only public addresses.
      const proc = execSync(
        `ssh ${sshTarget} "cat >> ${remote}"`,
        { input: block, stdio: ["pipe", "inherit", "inherit"] }
      );
      console.log(`Appended to ${sshTarget}:${remote}`);
    }
  }
}

function buildRemoteBlock(derived: Derived[]): string {
  return (
    "\n# Derived addresses (computed from _PRIVATE_KEY — synced via " +
    "scripts/derive-casper-wallet.ts)\n" +
    derived
      .map((d) => {
        const name = d.label.replace("LIGIS_CASPER_", "").toLowerCase();
        return [
          `LIGIS_CASPER_${name.toUpperCase()}_EVM_ADDRESS=${d.ethAddress}`,
          `LIGIS_CASPER_${name.toUpperCase()}_ACCOUNT_HASH=${d.accountHash}`,
        ].join("\n");
      })
      .join("\n") +
    "\n"
  );
}

main();
