/**
 * Runtime smoke test: prove that the browser-side crypto chain
 * (keypair.ts + eip712.ts) produces the same EVM-style signature +
 * recovered address as the server-side ethers path. Run with:
 *
 *   pnpm --filter @ligis/web exec tsx web/scripts/smoke-wallet-crypto.ts
 *
 * No Casper RPC. No funding. Pure Node + @noble/curves + ethers.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { ethers } from "ethers";

// Use a deterministic test vector so the run is reproducible.
const PRIV_HEX = "0x" + "11".repeat(32); // 32 zero-padded-ish bytes (works)
// Replace with a valid scalar.
const pkScalar = new Uint8Array(32).fill(0x11);

// ---------- BROWSER PATH (mirror of web/lib/casper-browser/keypair.ts) ----------
function browserEVMAddress(priv: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(priv, false); // uncompressed
  const hash = keccak_256(pub.slice(1)); // drop 0x04
  const addr = hash.slice(-20);
  let hex = "0x";
  for (const b of addr) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

function browserSign(digest: Uint8Array, priv: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(digest, priv);
  const compact = sig.toCompactRawBytes();
  const full = new Uint8Array(65);
  full.set(compact, 0);
  full[64] = 27 + (sig.recovery ?? 0);
  return full;
}

function browserRecoverPubkey(digest: Uint8Array, sig: Uint8Array): Uint8Array {
  const recovery = sig[64] - 27;
  const compact = sig.slice(0, 64);
  return secp256k1.Signature.fromCompact(compact).addRecoveryBit(recovery).recoverPublicKey(digest).toRawBytes(false);
}

// ---------- SERVER PATH (mirror of packages/adapter-casper operations.ts) ----------
function serverSign(digest: Uint8Array, priv: Uint8Array): Uint8Array {
  const wallet = new ethers.Wallet("0x" + Buffer.from(priv).toString("hex"));
  const hex = ethers.hexlify(digest);
  const sig = wallet.signingKey.sign(hex);
  const r = sig.r.slice(2).padStart(64, "0");
  const s = sig.s.slice(2).padStart(64, "0");
  const v = (sig.v ?? 27).toString(16).padStart(2, "0");
  return Uint8Array.from(
    Buffer.from(r + s + v, "hex"),
  );
}

// ---------- run ----------
console.log("=== Ligis browser↔server crypto smoke ===");
console.log("private key:", Buffer.from(pkScalar).toString("hex"));

const browserAddr = browserEVMAddress(pkScalar);
console.log("[browser] EVM addr :", browserAddr);

const wallet = new ethers.Wallet("0x" + Buffer.from(pkScalar).toString("hex"));
console.log("[ethers ] EVM addr :", wallet.address);

if (browserAddr.toLowerCase() !== wallet.address.toLowerCase()) {
  console.error("FAIL: address derivation mismatch");
  process.exit(1);
}
console.log("✓ addresses match");

// Sign a fake 32-byte EIP-712 digest.
const digest = keccak_256(new TextEncoder().encode("ligis smoke digest"));
const browserSig = browserSign(digest, pkScalar);
const serverSig = serverSign(digest, pkScalar);

console.log("[browser] sig last byte (v):", browserSig[64].toString(16));
console.log("[server ] sig last byte (v):", serverSig[64].toString(16));

// Compare r and s (last byte v may differ by 27 vs 0/1; both valid).
const browser_r = Buffer.from(browserSig.slice(0, 32)).toString("hex");
const browser_s = Buffer.from(browserSig.slice(32, 64)).toString("hex");
const server_r = Buffer.from(serverSig.slice(0, 32)).toString("hex");
const server_s = Buffer.from(serverSig.slice(32, 64)).toString("hex");

if (browser_r !== server_r) {
  console.error("FAIL: browser r != ethers r");
  console.error("  browser:", browser_r);
  console.error("  ethers :", server_r);
  process.exit(1);
}
console.log("✓ r matches between browser (@noble) and server (ethers)");
if (browser_s !== server_s) {
  console.error("FAIL: browser s != ethers s");
  console.error("  browser:", browser_s);
  console.error("  ethers :", server_s);
  process.exit(1);
}
console.log("✓ s matches between browser (@noble) and server (ethers)");

// Recover public key from the browser signature and verify recovered address.
const recoveredPub = browserRecoverPubkey(digest, browserSig);
const recoveredHash = keccak_256(recoveredPub.slice(1));
const recoveredAddr = "0x" + Buffer.from(recoveredHash.slice(-20)).toString("hex");
console.log("[recover] addr    :", recoveredAddr);
if (recoveredAddr.toLowerCase() !== browserAddr.toLowerCase()) {
  console.error("FAIL: signature recovery does not round-trip to the same address");
  process.exit(1);
}
console.log("✓ signature recovery round-trips to the same EVM address");
console.log("=== ALL CHECKS PASSED ===");
