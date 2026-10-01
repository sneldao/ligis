#!/usr/bin/env tsx
/**
 * Monad Testnet — Passkey-issued credential, verified by the P256 precompile.
 *
 * Proves the ERC-1271 issuer path end-to-end on chain:
 *   1. Enroll a P-256 (secp256r1 — the WebAuthn curve) public key on PasskeyIssuer
 *   2. Build a WebAuthn-shaped assertion whose challenge is the EIP-712 credential
 *      digest the registry computes
 *   3. Call CredentialRegistry.issue(issuer=PasskeyIssuer, …) — the registry
 *      staticcalls PasskeyIssuer.isValidSignature, which calls the 0x0100
 *      precompile to verify the passkey signature
 *   4. Gate flips GO for the subject
 *   5. Passkey-authorized revoke → gate flips STOP
 *
 * The P-256 key here is generated in Node (crypto) instead of a hardware
 * authenticator — same curve, same message shape, same on-chain verification.
 * The browser flow (navigator.credentials) produces byte-identical calldata.
 *
 * Usage:
 *   set -a && source .env.d/deployer.env && set +a
 *   export PRIVATE_KEY=$PHAROS_DEPLOYER_KEY
 *   npx tsx scripts/monad-passkey-issue.ts
 *
 * Env:
 *   LIGIS_PASSKEY_RP_ID  relying-party id hashed into authenticatorData
 *                        (default "ligis.vercel.app" — must match the on-chain rpIdHash)
 *   LIGIS_PASSKEY_KEEP   set to "1" to skip the revoke step (leaves a GO fixture)
 */
import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  http,
  keccak256,
  parseAbiItem,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { capabilityHash } from "@ligis/core";

const RP_ID = process.env.LIGIS_PASSKEY_RP_ID ?? "ligis.vercel.app";
const CAPABILITY = process.env.LIGIS_PASSKEY_CAPABILITY ?? "demo.passkey";

const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
} as const;

const networks = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../assets/networks.json"), "utf8"),
);
const deployment = networks.deployment["monad-testnet"];
const REGISTRY = deployment.credentialRegistry as `0x${string}`;
const PASSKEY_ISSUER = deployment.passkeyIssuer as `0x${string}`;

const REGISTRY_ABI = [
  parseAbiItem(
    "function hashTypedData(address issuer, address subject, bytes32 capabilityHash, uint256 issuedAt, uint256 expiresAt, uint256 nonce) view returns (bytes32)",
  ),
  parseAbiItem(
    "function issue(address issuer, address subject, bytes32 capabilityHash, uint64 issuedAt, uint64 expiresAt, uint256 nonce, bytes signature) returns (uint256)",
  ),
  parseAbiItem(
    "function isCapable(address subject, bytes32 capabilityHash) view returns (bool)",
  ),
  parseAbiItem("function issuerNonce(address issuer) view returns (uint256)"),
];

const ISSUER_ABI = [
  parseAbiItem(
    "function registerPasskey(bytes32 keyId, uint256 qx, uint256 qy)",
  ),
  parseAbiItem(
    "function revokeCredential(address registry, address subject, bytes32 capabilityHash, uint256 nonce, bytes32 keyId, bytes authenticatorData, bytes clientDataJSON, uint256 r, uint256 s)",
  ),
  parseAbiItem(
    "function passkeys(bytes32) view returns (uint256 qx, uint256 qy)",
  ),
];

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function sha256(data: Buffer | Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/**
 * Build a WebAuthn-shaped assertion for `challenge` (the value an RP would put
 * in navigator.credentials.get({ challenge })). Returns the byte fields a
 * browser ceremony produces.
 */
function webauthnAssertion(challenge: string, rpId: string) {
  const rpIdHash = sha256(Buffer.from(rpId, "utf8"));
  const authenticatorData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x05]), // flags: UP | UV
    Buffer.alloc(4), // signCount
  ]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge,
      origin: `https://${rpId}`,
    }),
    "utf8",
  );
  // NOTE: Node crypto.sign(null, input, ecKey) internally applies SHA-256 —
  // the signed digest is sha256(input). To sign msgHash = sha256(authData ‖
  // sha256(clientDataJSON)) we pass the pre-hash input and let Node hash it.
  const preImage = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  const msgHash = sha256(preImage);
  return { authenticatorData, clientDataJSON, preImage, msgHash };
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY not set (source .env.d/deployer.env)");

  const account = privateKeyToAccount(pk as Hex);
  // Fresh subject each run so the gate flip is unambiguous (no other issuer's
  // credential on this subject can hold the gate open). Override with
  // LIGIS_PASSKEY_SUBJECT to target a specific address (e.g. demo fixtures).
  const subject = (process.env.LIGIS_PASSKEY_SUBJECT ??
    `0x${createHash("sha256").update(`subj-${Date.now()}`).digest("hex").slice(0, 40)}`) as `0x${string}`;
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(
      process.env.LIGIS_RPC_URL ?? monadTestnet.rpcUrls.default.http[0],
    ),
  });
  const wallet = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(
      process.env.LIGIS_RPC_URL ?? monadTestnet.rpcUrls.default.http[0],
    ),
  });

  console.log(
    `${BOLD}${CYAN}Ligis × PasskeyIssuer — P256 credential issuance on Monad${RESET}\n`,
  );
  console.log(`  Registry:      ${REGISTRY}`);
  console.log(`  PasskeyIssuer: ${PASSKEY_ISSUER}`);
  console.log(`  Subject:       ${subject}`);
  console.log(`  RP ID:         ${RP_ID}`);

  // 1. Generate a P-256 keypair (the "passkey") and enroll it on-chain.
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const qx = BigInt(`0x${Buffer.from(jwk.x!, "base64url").toString("hex")}`);
  const qy = BigInt(`0x${Buffer.from(jwk.y!, "base64url").toString("hex")}`);
  const credentialId = keccak256(toHex(`ligis-demo-${Date.now()}`));
  const keyId = credentialId;

  const enrollHash = await wallet.writeContract({
    address: PASSKEY_ISSUER,
    abi: ISSUER_ABI,
    functionName: "registerPasskey",
    args: [keyId, qx, qy],
  });
  await publicClient.waitForTransactionReceipt({ hash: enrollHash });
  console.log(
    `\n  ${GREEN}✓${RESET} Passkey enrolled (keyId ${keyId.slice(0, 14)}…) · tx ${enrollHash.slice(0, 14)}…`,
  );

  // 2. Compute the EIP-712 digest the registry will ask the issuer to bless.
  const nonce = await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "issuerNonce",
    args: [PASSKEY_ISSUER],
  });
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + 365n * 24n * 3600n;
  const capHash = capabilityHash(CAPABILITY) as Hex;
  const digest = await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "hashTypedData",
    args: [PASSKEY_ISSUER, subject, capHash, issuedAt, expiresAt, nonce],
  });

  // 3. WebAuthn-shaped assertion: challenge = base64url(digest).
  const { authenticatorData, clientDataJSON, preImage } = webauthnAssertion(
    b64url(Buffer.from(digest.slice(2), "hex")),
    RP_ID,
  );
  const sig = cryptoSign(null, preImage, {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const r = BigInt(`0x${sig.subarray(0, 32).toString("hex")}`);
  const s = BigInt(`0x${sig.subarray(32, 64).toString("hex")}`);
  console.log(
    `  ${GREEN}✓${RESET} Assertion signed (challenge binds digest ${digest.slice(0, 14)}…)`,
  );

  const erc1271Sig = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes" },
      { type: "bytes" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [
      keyId,
      `0x${authenticatorData.toString("hex")}` as Hex,
      `0x${clientDataJSON.toString("hex")}` as Hex,
      r,
      s,
    ],
  );

  // 4. Submit — registry → PasskeyIssuer.isValidSignature → 0x0100 precompile.
  const issueHash = await wallet.writeContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "issue",
    args: [
      PASSKEY_ISSUER,
      subject,
      capHash,
      issuedAt,
      expiresAt,
      nonce,
      erc1271Sig,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: issueHash });
  console.log(
    `  ${GREEN}✓${RESET} Credential issued — verified by the 0x0100 precompile on-chain`,
  );
  console.log(`      tx ${issueHash}`);

  const capable = await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "isCapable",
    args: [subject, capHash],
  });
  console.log(
    `  ${capable ? GREEN : RED}isCapable(${CAPABILITY}) = ${capable}${RESET}`,
  );
  if (!capable) {
    console.error("Expected GO after passkey issuance");
    process.exit(1);
  }

  let revokeHash: Hex | undefined;
  if (process.env.LIGIS_PASSKEY_KEEP !== "1") {
    // 5. Passkey-authorized revoke.
    // Must match the contract's abi.encodePacked("LigisPasskeyRevoke", registry,
    // subject, capabilityHash, nonce, block.chainid)
    const revokeDigest = keccak256(
      encodePacked(
        ["string", "address", "address", "bytes32", "uint256", "uint256"],
        [
          "LigisPasskeyRevoke",
          REGISTRY,
          subject,
          capHash,
          nonce,
          BigInt(monadTestnet.id),
        ],
      ),
    );
    const rev = webauthnAssertion(
      b64url(Buffer.from(revokeDigest.slice(2), "hex")),
      RP_ID,
    );
    const rsig = cryptoSign(null, rev.preImage, {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const rr = BigInt(`0x${rsig.subarray(0, 32).toString("hex")}`);
    const rs = BigInt(`0x${rsig.subarray(32, 64).toString("hex")}`);

    revokeHash = await wallet.writeContract({
      address: PASSKEY_ISSUER,
      abi: ISSUER_ABI,
      functionName: "revokeCredential",
      args: [
        REGISTRY,
        subject,
        capHash,
        nonce,
        keyId,
        `0x${rev.authenticatorData.toString("hex")}` as Hex,
        `0x${rev.clientDataJSON.toString("hex")}` as Hex,
        rr,
        rs,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: revokeHash });
    const still = await publicClient.readContract({
      address: REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "isCapable",
      args: [subject, capHash],
    });
    console.log(
      `  ${GREEN}✓${RESET} Passkey-authorized revoke · tx ${revokeHash.slice(0, 14)}…`,
    );
    console.log(
      `  ${still ? RED : GREEN}isCapable(${CAPABILITY}) = ${still}${RESET}`,
    );
    if (still) {
      console.error("Expected STOP after revocation");
      process.exit(1);
    }
  }

  const outPath = resolve(
    import.meta.dirname,
    "monad-passkey-issue.lastrun.txt",
  );
  writeFileSync(
    outPath,
    [
      `network=monad-testnet`,
      `chainId=${monadTestnet.id}`,
      `registry=${REGISTRY}`,
      `passkeyIssuer=${PASSKEY_ISSUER}`,
      `subject=${subject}`,
      `rpId=${RP_ID}`,
      `capability=${CAPABILITY}`,
      `capabilityHash=${capHash}`,
      `keyId=${keyId}`,
      `enrollTx=${enrollHash}`,
      `issueTx=${issueHash}`,
      `revokeTx=${revokeHash ?? "skipped (LIGIS_PASSKEY_KEEP=1)"}`,
      `gateAfter=${revokeHash ? false : true}`,
      `explorer=https://testnet.monadscan.com/tx/${issueHash}`,
      "",
    ].join("\n"),
  );

  console.log(
    `\n${GREEN}${BOLD}PASSKEY ISSUANCE VERIFIED ON MONAD TESTNET${RESET}`,
  );
  console.log(
    "  Issuer: a contract, not an env file. Authorized by P-256 via 0x0100.\n",
  );
}

main().catch((e) => {
  console.error(`${RED}✗${RESET}`, e instanceof Error ? e.message : e);
  process.exit(1);
});
