#!/usr/bin/env tsx
/**
 * ligis.gate — first live test order.
 *
 * Acts as a CROO buyer: negotiates an order for the `ligis.gate` listing
 * (default 3b5f6e3b-a22b-4b52-925b-366656ebd47c — override with
 * CROO_GATE_LISTING), pays on the order_created event, and polls for the
 * delivery — the first real Jev verdict receipt produced through the CROO
 * Agent Store.
 *
 * Flow (mirrors packages/croo-adapter/src/requester.ts):
 *   negotiate → [provider accepts] → order_created event → payOrder
 *   → [provider fulfills] → poll getDelivery → receipt
 *
 * Requirements use gate-shaped data against the Ligis agent's own Casper
 * identity, with a deliberately misdirected payee so the expected receipt
 * is a confident STOP — proof the reflex works end-to-end through a real
 * paid order. Set REQUIREMENTS_VARIANT=legit for the GO variant.
 *
 * Env needed:
 *   CROO_BUYER_SDK_KEY     — buyer SDK key from a NON-Ligis agent with wallet
 *                            funds (CROO forbids negotiating your own service).
 *                            Lives in .env.d/croo-buyer.env — NEVER in
 *                            .env.d/croo.env, which holds the provider key.
 *   CROO_SDK_KEY           — Ligis provider key; loaded only for the
 *                            equality guard below
 *   CROO_API_URL, CROO_WS_URL (optional, defaults are prod)
 *
 * Optional:
 *   CROO_GATE_LISTING     — listing id override (default svc-new-1789916778613)
 *   CROO_BUYER_SUBJECT    — subject override for the credential check
 *   REQUIREMENTS_VARIANT  — "misdirected" (default) | "legit"
 *
 * Output: scripts/croo-gate-test-order.lastrun.txt
 * Exit 0 on delivered receipt, 1 otherwise.
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Buyer identity is deliberately a DIFFERENT variable (and file) from the
// provider's CROO_SDK_KEY so the two can never clobber each other.
const SDK_KEY = process.env.CROO_BUYER_SDK_KEY;
const PROVIDER_KEY = process.env.CROO_SDK_KEY; // loaded only for the guard
const API_URL = process.env.CROO_API_URL ?? "https://api.croo.network";
const WS_URL = process.env.CROO_WS_URL ?? "wss://api.croo.network/ws";
const LISTING =
  process.env.CROO_GATE_LISTING ?? "3b5f6e3b-a22b-4b52-925b-366656ebd47c";
const VARIANT = process.env.REQUIREMENTS_VARIANT ?? "misdirected";

if (!SDK_KEY) {
  console.error(
    "Missing CROO_BUYER_SDK_KEY (a non-Ligis buyer key with wallet funds)",
  );
  process.exit(1);
}
if (PROVIDER_KEY && SDK_KEY === PROVIDER_KEY) {
  console.error(
    "CROO_BUYER_SDK_KEY equals the provider key — CROO rejects self-negotiation. Use a different agent's key.",
  );
  process.exit(1);
}

// The Ligis agent's own Casper identity (the counterparty we probe).
const SUBJECT =
  process.env.CROO_BUYER_SUBJECT ??
  "account-hash-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37";

const ADVERTISED_PAYEE =
  "account-hash-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1";

/** Misdirected-payee variant — expected verdict: STOP (payee-mismatch). */
const MISDIRECTED = {
  subject: SUBJECT,
  capability: "data.premium",
  priceSmallestUnit: "1000000000", // 1 CSPR
  payTo: ADVERTISED_PAYEE,
  tokenSymbol: "CSPR",
  tokenDecimals: "9",
  payment: {
    scheme: "exact",
    amountSmallestUnit: "1000000000",
    // payment.payTo deliberately different: the misdirection being judged.
    payTo: SUBJECT,
  },
  capabilityDescription:
    "One-shot access to a premium data feed offered by the Ligis agent",
};

/** Legit variant — expected verdict: GO. */
const LEGIT = {
  ...MISDIRECTED,
  payment: {
    scheme: "exact",
    amountSmallestUnit: "1000000000",
    payTo: ADVERTISED_PAYEE,
  },
};

const REQUIREMENTS = VARIANT === "legit" ? LEGIT : MISDIRECTED;

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 6 * 60_000;

async function main(): Promise<void> {
  // Resolve the SDK through the croo-adapter package (pnpm strict layout —
  // the root workspace doesn't link @croo-network/sdk).
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const pkgReq = createRequire(
    join(__dirname, "../packages/croo-adapter/package.json"),
  );
  const sdk = (await import(
    pathToFileURL(pkgReq.resolve("@croo-network/sdk")).href
  )) as {
    AgentClient: new (
      config: { baseURL: string; wsURL: string },
      sdkKey: string,
    ) => unknown;
  };
  const client = new sdk.AgentClient(
    { baseURL: API_URL, wsURL: WS_URL },
    SDK_KEY,
  ) as unknown as {
    connectWebSocket(): Promise<{
      on(e: string, h: (p: unknown) => void): void;
      close?: () => void;
    }>;
    negotiateOrder(req: {
      serviceId: string;
      requirements: string;
    }): Promise<{ negotiationId: string; status: string }>;
    payOrder(
      orderId: string,
    ): Promise<{ order: { orderId: string }; txHash: string }>;
    getDelivery(orderId: string): Promise<{ deliverableText?: string } | null>;
  };

  const stream = await client.connectWebSocket();
  console.log("[test-order] websocket connected");

  let paid = false;
  let orderId = "";
  let payTxHash = "";
  let paidAt = 0;

  // Pay as soon as the provider accepts and CROO creates the order.
  stream.on("order_created", (payload: unknown) => {
    const ev = payload as { order_id?: string; orderId?: string };
    const id = ev.order_id ?? ev.orderId;
    if (!id || paid) return;
    paid = true;
    orderId = id;
    console.log(`[test-order] order created: ${orderId} — paying…`);
    client
      .payOrder(orderId)
      .then((res) => {
        payTxHash = res.txHash;
        paidAt = Date.now();
        console.log(`[test-order] paid. tx: ${payTxHash}`);
      })
      .catch((err: unknown) => {
        console.error("[test-order] payOrder failed:", err);
        process.exit(1);
      });
  });

  console.log(
    `[test-order] negotiating (${VARIANT} variant) for listing ${LISTING}…`,
  );
  const neg = await client.negotiateOrder({
    serviceId: LISTING,
    requirements: JSON.stringify(REQUIREMENTS),
  });
  console.log(
    `[test-order] negotiation ${neg.negotiationId} status=${neg.status}`,
  );

  const t0 = Date.now();
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (!orderId) {
      process.stdout.write(
        `\r[test-order] waiting for the provider to accept… ${Math.round((Date.now() - t0) / 1000)}s   `,
      );
      continue;
    }
    try {
      const delivery = await client.getDelivery(orderId);
      if (delivery?.deliverableText) {
        const receipt = {
          orderId,
          negotiationId: neg.negotiationId,
          listing: LISTING,
          service: "ligis.gate",
          variant: VARIANT,
          payTxHash,
          receivedAt: new Date().toISOString(),
          orderToDeliveryMs: paidAt ? Date.now() - paidAt : null,
          deliverable: JSON.parse(delivery.deliverableText),
        };
        const out = join(__dirname, "croo-gate-test-order.lastrun.txt");
        fs.writeFileSync(out, JSON.stringify(receipt, null, 2));
        console.log(`\n\n[test-order] receipt saved → ${out}\n`);
        console.log(JSON.stringify(receipt.deliverable, null, 2));
        const intent = receipt.deliverable?.intent;
        if (intent?.verdict) {
          console.log(
            `\n[test-order] ✓ first live verdict: ${intent.verdict}` +
              (intent.confidence !== undefined
                ? ` (conf ${intent.confidence})`
                : "") +
              (intent.latencyMs ? ` in ${intent.latencyMs}ms` : "") +
              " — the reflex works through CROO.",
          );
        }
        stream.close?.();
        process.exit(0);
      }
    } catch {
      // not delivered yet
    }
    process.stdout.write(
      `\r[test-order] order ${orderId} — waiting for delivery… ${Math.round((Date.now() - t0) / 1000)}s   `,
    );
  }

  console.error(
    `\n[test-order] timed out after ${MAX_WAIT_MS / 1000}s (orderId: ${orderId || "none"})`,
  );
  stream.close?.();
  process.exit(1);
}

main().catch((err) => {
  console.error("[test-order] failed:", err);
  process.exit(1);
});
