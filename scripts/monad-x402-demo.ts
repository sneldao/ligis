#!/usr/bin/env tsx
/**
 * Monad Testnet — x402 trust-gate demo (EVM path).
 *
 *   1. Subject is issued the gate capability (data.premium) on-chain
 *   2. GET /premium, X-Subject = agent  → 402 + x402 v2 PaymentRequirements
 *   3. Payer signs EIP-3009 TransferWithAuthorization → PAYMENT-SIGNATURE
 *   4. Server verifies via molandak facilitator → settles on-chain → 200
 *   5. Revoke the credential mid-stream
 *   6. Next request → 401 STOP — payment never attempted
 *
 * Server (terminal 1):
 *   LIGIS_X402_NETWORK=monad-testnet LIGIS_GATE_PAY_TO=0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec \
 *   LIGIS_X402_ASSET=0x16f6bD0c285a630fe72275909c0f5815d276E2f4 \
 *   npx tsx packages/x402-server/src/index.ts
 *
 * Client (terminal 2):
 *   set -a && source .env.d/deployer.env && source .env.d/zerog.env && set +a
 *   export LIGIS_NETWORK=monad-testnet PRIVATE_KEY=$PHAROS_DEPLOYER_KEY
 *   export LIGIS_X402_PAYER_KEY=$ZEROG_PRIVATE_KEY
 *   npx tsx scripts/monad-x402-demo.ts
 *
 * Asset: defaults to TestUSDC (packages/contracts-evm/src/TestUSDC.sol), a real
 * EIP-3009 token deployed at 0x16f6bD0c…E2f4 — Circle's canonical testnet USDC
 * (0x534b2f…43A3) works identically once a wallet holds it (faucet.circle.com).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbiItem,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { capabilityHash } from "@ligis/core";
import { EvmAdapter } from "@ligis/adapter-evm";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const GATE_URL = process.env.LIGIS_GATE_URL ?? "http://127.0.0.1:4040";
const CAPABILITY = process.env.LIGIS_X402_CAPABILITY ?? "data.premium";

const networks = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../assets/networks.json"), "utf8"),
);
const deployment = networks.deployment["monad-testnet"];
const REGISTRY = deployment.credentialRegistry as Hex;
const ASSET = (process.env.LIGIS_X402_ASSET ??
  "0x16f6bD0c285a630fe72275909c0f5815d276E2f4") as Hex;

const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
} as const;

const REGISTRY_ABI = [
  parseAbiItem(
    "function isCapable(address subject, bytes32 capabilityHash) view returns (bool)",
  ),
];

type PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string };
};

async function gateFetch(subject: string, paymentHeader?: string) {
  const headers: Record<string, string> = { "X-Subject": subject };
  if (paymentHeader) headers["PAYMENT-SIGNATURE"] = paymentHeader;
  const res = await fetch(`${GATE_URL}/premium`, { headers });
  const body = (await res.json()) as Record<string, unknown>;
  return {
    status: res.status,
    body,
    paymentResponse: res.headers.get("PAYMENT-RESPONSE"),
  };
}

async function main() {
  const ownerPk = process.env.PRIVATE_KEY;
  const payerPk =
    process.env.LIGIS_X402_PAYER_KEY ?? process.env.ZEROG_PRIVATE_KEY;
  if (!ownerPk || !payerPk) {
    throw new Error(
      "PRIVATE_KEY and LIGIS_X402_PAYER_KEY (or ZEROG_PRIVATE_KEY) required",
    );
  }
  const ownerAccount = privateKeyToAccount(ownerPk as Hex);
  const subject = ownerAccount.address;
  const payer = privateKeyToAccount(payerPk as Hex);

  const transport = http(
    process.env.LIGIS_RPC_URL ?? monadTestnet.rpcUrls.default.http[0],
  );
  const publicClient = createPublicClient({ chain: monadTestnet, transport });
  const payerWallet = createWalletClient({
    account: payer,
    chain: monadTestnet,
    transport,
  });
  const adapter = new EvmAdapter();

  console.log(
    `${BOLD}${CYAN}Ligis × x402 — credential-gated payment on Monad${RESET}\n`,
  );
  console.log(`  Gate:     ${GATE_URL}`);
  console.log(`  Subject:  ${subject} (credential holder)`);
  console.log(`  Payer:    ${payer.address} (signs EIP-3009)`);
  console.log(`  Asset:    ${ASSET}`);
  console.log(`  Registry: ${REGISTRY}\n`);

  const capHash = capabilityHash(CAPABILITY) as Hex;

  // 0. Ensure the subject holds the gate capability — issue a fresh nonce.
  const capableNow = await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "isCapable",
    args: [subject, capHash],
  });
  let issuedNonce: string;
  if (capableNow) {
    // A prior credential exists; still mint a fresh nonce so the revoke below
    // only kills this run's credential (any prior one stays as backup).
    const signed = await adapter.signCredential({
      issuerKey: ownerPk,
      subject,
      capability: CAPABILITY,
    });
    await adapter.submitCredential(signed);
    issuedNonce = signed.nonce;
    console.log(
      `  ${GREEN}✓${RESET} fresh ${CAPABILITY} credential issued (nonce ${issuedNonce})`,
    );
  } else {
    const signed = await adapter.signCredential({
      issuerKey: ownerPk,
      subject,
      capability: CAPABILITY,
    });
    await adapter.submitCredential(signed);
    issuedNonce = signed.nonce;
    console.log(`  ${GREEN}✓${RESET} credential issued (nonce ${issuedNonce})`);
  }
  const nowCapable = await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "isCapable",
    args: [subject, capHash],
  });
  console.log(`  isCapable(${CAPABILITY}) = ${nowCapable}`);
  if (!nowCapable) {
    console.error(`${RED}credential issuance did not flip the gate${RESET}`);
    process.exit(1);
  }

  // 1. No payment → 402
  const r1 = await gateFetch(subject);
  console.log(`\n  ${GREEN}✓${RESET} no payment → ${r1.status}`);
  if (r1.status !== 402) {
    console.error("expected 402", r1.body);
    process.exit(1);
  }
  const accepts = (r1.body.accepts as PaymentRequirements[])[0];
  console.log(
    `    accepts: ${accepts.amount} units of ${accepts.asset} → ${accepts.payTo} (${accepts.network})`,
  );

  // 2. Sign EIP-3009 TransferWithAuthorization
  const now = Math.floor(Date.now() / 1000);
  const nonce = keccak256(toHex(`x402-${Date.now()}`));
  const authorization = {
    from: payer.address,
    to: accepts.payTo as Hex,
    value: BigInt(accepts.amount),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + accepts.maxTimeoutSeconds),
    nonce,
  };
  const signature = await payerWallet.signTypedData({
    domain: {
      name: accepts.extra?.name ?? "USDC",
      version: accepts.extra?.version ?? "2",
      chainId: monadTestnet.id,
      verifyingContract: accepts.asset as Hex,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce,
    },
  });
  console.log(
    `  ${GREEN}✓${RESET} EIP-3009 authorization signed (nonce ${nonce.slice(0, 14)}…)`,
  );

  const paymentPayload = {
    x402Version: 2,
    resource: { url: `${GATE_URL}/premium` },
    accepted: accepts,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
    extensions: {},
  };
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString(
    "base64",
  );

  // 3. Pay → 200
  const r2 = await gateFetch(subject, paymentHeader);
  console.log(
    `  ${r2.status === 200 ? GREEN + "✓" : RED + "✗"} paid request → ${r2.status}${RESET}`,
  );
  if (r2.status !== 200) {
    console.error("expected 200", JSON.stringify(r2.body).slice(0, 500));
    process.exit(1);
  }
  const settleTx =
    (r2.body as { settled?: { txHash?: string } }).settled?.txHash ??
    r2.paymentResponse;
  console.log(`    settled tx: ${settleTx}`);
  console.log(`    ${DIM}https://testnet.monadscan.com/tx/${settleTx}${RESET}`);

  // 4. Kill the credential mid-stream. isCapable is true while ANY issuer's
  // credential is live, so revoke every live nonce for this subject+capability
  // (all issued by the same owner key).
  const revokedTxs: string[] = [];
  for (let n = 0n; n < 16n; n++) {
    let c: [string, bigint, bigint, boolean, boolean];
    try {
      c = (await publicClient.readContract({
        address: REGISTRY,
        abi: [
          parseAbiItem(
            "function getCredential(address subject, bytes32 capabilityHash, uint256 nonce) view returns (address issuer, uint64 issuedAt, uint64 expiresAt, bool revoked, bool valid)",
          ),
        ],
        functionName: "getCredential",
        args: [subject, capHash, n],
      })) as [string, bigint, bigint, boolean, boolean];
    } catch {
      continue;
    }
    const [, , , revoked, valid] = c;
    if (!valid || revoked) continue;
    const tx = await adapter.revokeCredential({
      subject,
      capability: CAPABILITY,
      nonce: n.toString(),
    });
    revokedTxs.push(tx.tx.hash);
    console.log(
      `  ${GREEN}✓${RESET} credential revoked (nonce ${n}) · tx ${tx.tx.hash.slice(0, 14)}…`,
    );
  }
  if (revokedTxs.length === 0) {
    console.error(`${RED}no live credential found to revoke${RESET}`);
    process.exit(1);
  }

  // 5. Next request → 401. The credential is dead; payment is never attempted.
  const r3 = await gateFetch(subject, paymentHeader);
  const stopped = r3.status === 401;
  console.log(
    `  ${stopped ? GREEN + "✓" : RED + "✗"} post-revocation request → ${r3.status}${stopped ? " · STOP" : ""}${RESET}`,
  );
  if (!stopped) {
    console.error(
      "expected 401 after revocation",
      JSON.stringify(r3.body).slice(0, 300),
    );
    process.exit(1);
  }

  writeFileSync(
    resolve(import.meta.dirname, "monad-x402-demo.lastrun.txt"),
    [
      `network=monad-testnet`,
      `chainId=${monadTestnet.id}`,
      `gate=${GATE_URL}`,
      `subject=${subject}`,
      `payer=${payer.address}`,
      `asset=${ASSET}`,
      `capability=${CAPABILITY}`,
      `capabilityHash=${capHash}`,
      `credentialNonce=${issuedNonce}`,
      `settleTx=${settleTx}`,
      ...revokedTxs.map((t, i) => `revokeTx${i}=${t}`),
      `gateAfter=401 (STOP)`,
      `explorer=https://testnet.monadscan.com/tx/${settleTx}`,
      "",
    ].join("\n"),
  );

  console.log(
    `\n${GREEN}${BOLD}X402 TRUST GATE VERIFIED ON MONAD TESTNET${RESET}`,
  );
  console.log(
    `  credential + payment → 200 · revoked credential → 401 before payment\n`,
  );
}

main().catch((e) => {
  console.error(`${RED}✗${RESET}`, e instanceof Error ? e.message : e);
  process.exit(1);
});
