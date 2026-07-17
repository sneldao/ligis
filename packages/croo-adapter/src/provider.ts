import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EventType } from "@croo-network/sdk";
import { handleVerify } from "./verify.js";
import { handleIssue } from "./issue.js";
import { handleRisk } from "./risk.js";
import type { CrooClient, EventStreamLike } from "./client.js";
import {
  type ServiceDescriptor,
  type ServiceRequest,
  type ServiceResult,
  type SupportedServiceId,
  SUPPORTED_SERVICES,
} from "./services.js";

const require = createRequire(import.meta.url);

/** Maximum time a service handler can run before timing out. */
const HANDLER_TIMEOUT_MS = 30_000;

/** Max delivery retries before giving up. */
const MAX_DELIVERY_RETRIES = 3;

/** Retry backoff base in ms. */
const RETRY_BASE_DELAY_MS = 1_000;

/** Interval for pruning old idempotency entries. */
const PRUNE_INTERVAL_MS = 3_600_000; // 1 hour

/** Age threshold for pruning (7 days). */
const PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProviderOptions {
  client: CrooClient;
  services?: ServiceDescriptor[];
  /**
   * Path to a SQLite file for persistent idempotency tracking.
   * If set, fulfilled orders survive process restarts.
   * If omitted, falls back to in-memory Set (lost on restart).
   */
  idempotencyDbPath?: string;
  /**
   * Map of CROO listing UUIDs to Ligis service IDs.
   * CROO sends the listing UUID as `service_id` in negotiation events,
   * but the provider matches by service name (e.g. "ligis.verify").
   * This map bridges the two. Example:
   *   { "10d687a6-...": "ligis.verify", "abc-...": "ligis.risk" }
   */
  serviceIdAliases?: Map<string, string>;
}

/**
 * Default Ligis services offered on CROO.
 *
 * Register these service IDs in the CROO Dashboard when creating your agent.
 */
export const defaultServices: ServiceDescriptor[] = [
  {
    id: "ligis.risk",
    name: "Ligis Counterparty Risk Check",
    description:
      "Verify that another AI agent holds the credentials required for a paid job before you hire or pay it. Returns a pass/warn/fail verdict and a 0–100 risk score. Cross-chain on Casper and Pharos.",
    priceUsd: "0.75",
    inputSchema: {
      type: "object",
      required: ["subject", "capabilities"],
      properties: {
        subject: {
          type: "string",
          description: "Agent DID or chain-native address of the counterparty",
        },
        capabilities: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
          description:
            "Required capability name(s), e.g. agent.commerce.escrow",
        },
        issuer: {
          type: "string",
          description: "Optional trusted issuer address to constrain the check",
        },
        minTtlSeconds: {
          type: "number",
          description:
            "Minimum remaining credential lifetime in seconds (default 86400)",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        overallVerdict: { type: "string" },
        riskScore: { type: "number" },
        checks: { type: "array" },
        summary: { type: "string" },
      },
    },
    handler: handleRisk,
  },
  {
    id: "ligis.verify",
    name: "Ligis Credential Verification",
    description:
      "On-chain verification that an AI agent holds a valid, non-expired, non-revoked Ligis capability credential. Works on Casper and Pharos.",
    priceUsd: "0.50",
    inputSchema: {
      type: "object",
      required: ["subject", "capability"],
      properties: {
        subject: {
          type: "string",
          description: "Agent DID or chain-native address to verify",
        },
        capability: {
          type: "string",
          description: "Capability name, e.g. agent.commerce.escrow",
        },
        issuer: {
          type: "string",
          description: "Optional trusted issuer address to constrain the check",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        capable: { type: "boolean" },
        capabilityHash: { type: "string" },
        latestCredential: { type: "object" },
      },
    },
    handler: handleVerify,
  },
  {
    id: "ligis.issue",
    name: "Ligis Credential Issuance",
    description:
      "Issue a signed, revocable Ligis capability credential to a subject. Requires issuer key configuration.",
    priceUsd: "2.00",
    inputSchema: {
      type: "object",
      required: ["subject", "capability"],
      properties: {
        subject: {
          type: "string",
          description:
            "Agent DID or chain-native address to receive the credential",
        },
        capability: {
          type: "string",
          description: "Capability name, e.g. kyc.verified",
        },
        expiresInSeconds: {
          type: "number",
          description: "Credential lifetime in seconds",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        capabilityHash: { type: "string" },
        txHash: { type: "string" },
      },
    },
    handler: handleIssue,
  },
];

/**
 * Persistent idempotency store backed by SQLite.
 *
 * Survives process restarts so duplicate OrderPaid events after a
 * restart don't cause double delivery. Falls back to in-memory Set
 * when no DB path is configured.
 */
interface IdempotencyStore {
  has(orderId: string): boolean;
  add(orderId: string): void;
  delete(orderId: string): void;
  prune(maxAgeMs: number): number;
  close(): void;
}

class MemoryIdempotencyStore implements IdempotencyStore {
  private set = new Set<string>();
  has(id: string) { return this.set.has(id); }
  add(id: string) { this.set.add(id); }
  delete(id: string) { this.set.delete(id); }
  prune(): number { return 0; }
  close() { this.set.clear(); }
}

class SqliteIdempotencyStore implements IdempotencyStore {
  private db: import("node:sqlite").DatabaseSync;
  private stmtHas: import("node:sqlite").StatementSync;
  private stmtAdd: import("node:sqlite").StatementSync;
  private stmtDel: import("node:sqlite").StatementSync;
  private stmtPrune: import("node:sqlite").StatementSync;

  constructor(path: string) {
    // Ensure the parent directory exists — SQLite won't create it.
    mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS fulfilled_orders (order_id TEXT PRIMARY KEY, fulfilled_at INTEGER NOT NULL)",
    );
    this.stmtHas = this.db.prepare("SELECT 1 FROM fulfilled_orders WHERE order_id = ?");
    this.stmtAdd = this.db.prepare(
      "INSERT OR IGNORE INTO fulfilled_orders (order_id, fulfilled_at) VALUES (?, ?)",
    );
    this.stmtDel = this.db.prepare("DELETE FROM fulfilled_orders WHERE order_id = ?");
    this.stmtPrune = this.db.prepare("DELETE FROM fulfilled_orders WHERE fulfilled_at < ?");
  }

  has(id: string): boolean {
    return this.stmtHas.get(id) !== undefined;
  }
  add(id: string): void {
    this.stmtAdd.run(id, Date.now());
  }
  delete(id: string): void {
    this.stmtDel.run(id);
  }
  prune(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.stmtPrune.run(cutoff);
    return Number(result.changes ?? 0);
  }
  close(): void {
    this.db.close();
  }
}

export class LigisCrooProvider {
  private client: CrooClient;
  private serviceMap: Map<string, ServiceDescriptor>;
  private serviceAliases: Map<string, string>;
  private fulfilledOrders: IdempotencyStore;
  /** Cache of negotiationId -> { serviceId, requirements } for order fulfillment. */
  private negotiationCache: Map<string, { serviceId: string; requirements: string }> = new Map();
  /** Orders currently being fulfilled (prevents duplicate concurrent processing). */
  private inFlight: Set<string> = new Set();
  /** Timestamp of last successful delivery, for health monitoring. */
  private lastDeliveryAt = 0;
  /** Total orders delivered, for health monitoring. */
  private deliveredCount = 0;
  /** Total errors, for health monitoring. */
  private errorCount = 0;
  /** Process start time, for uptime reporting. */
  private startedAt = Date.now();
  /** WebSocket connection status. */
  private wsConnected = false;
  /** Prune timer handle. */
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: ProviderOptions) {
    this.client = opts.client;
    this.serviceMap = new Map(
      (opts.services ?? defaultServices).map((s) => [s.id, s]),
    );
    this.serviceAliases = opts.serviceIdAliases ?? new Map();
    this.fulfilledOrders = opts.idempotencyDbPath
      ? new SqliteIdempotencyStore(opts.idempotencyDbPath)
      : new MemoryIdempotencyStore();
  }

  /**
   * Start the provider WebSocket loop and background maintenance.
   */
  async start(): Promise<EventStreamLike> {
    const stream = await this.client.connectWebSocket();
    this.wsConnected = true;

    stream.on(EventType.NegotiationCreated, async (event) => {
      const negotiationId = (event as { negotiation_id?: string })
        .negotiation_id;
      if (!negotiationId) return;
      await this.onNegotiationCreated(negotiationId, event);
    });

    stream.on(EventType.OrderPaid, async (event) => {
      const orderId = (event as { order_id?: string }).order_id;
      if (!orderId) return;
      await this.onOrderPaid(orderId, event);
    });

    // Periodic pruning of old idempotency entries.
    // unref() so the timer doesn't keep the process alive in tests.
    this.pruneTimer = setInterval(() => {
      try {
        const pruned = this.fulfilledOrders.prune(PRUNE_MAX_AGE_MS);
        if (pruned > 0) {
          console.log(`[ligis-croo] pruned ${pruned} old idempotency entries`);
        }
      } catch (err) {
        console.error(`[ligis-croo] prune failed:`, err);
      }
    }, PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();

    return stream;
  }

  /**
   * Resolve a CROO service ID (which may be a listing UUID) to a
   * Ligis service name. Checks the alias map first, then falls back
   * to direct lookup.
   */
  private resolveServiceId(rawId: string): string | undefined {
    if (this.serviceMap.has(rawId)) return rawId;
    return this.serviceAliases.get(rawId);
  }

  private async onNegotiationCreated(
    negotiationId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
  ): Promise<void> {
    console.log(`[ligis-croo] negotiation created: ${negotiationId}`);

    // The WebSocket event is sparse — fetch full details from the API
    // so we have service_id and requirements before accepting.
    let rawServiceId: string | undefined = event.service_id ?? event.serviceId;
    let requirements: string | undefined = event.requirements;

    if (!rawServiceId || !requirements) {
      try {
        const neg = await this.client.getNegotiation(negotiationId);
        rawServiceId = neg.serviceId;
        requirements = neg.requirements;
      } catch (err) {
        console.error(`[ligis-croo] failed to fetch negotiation ${negotiationId}:`, err);
      }
    }

    const serviceId = rawServiceId ? this.resolveServiceId(rawServiceId) : undefined;

    if (!serviceId || !this.serviceMap.has(serviceId)) {
      console.log(`[ligis-croo] rejecting: unsupported service ${rawServiceId}`);
      await this.client.rejectNegotiation(
        negotiationId,
        `Unsupported service: ${rawServiceId ?? "unknown"}`,
      );
      return;
    }

    // Cache for order fulfillment — the order_paid event doesn't
    // include service_id or requirements, so we need them from here.
    if (requirements) {
      this.negotiationCache.set(negotiationId, { serviceId, requirements });
    }

    try {
      await this.client.acceptNegotiation(negotiationId);
      console.log(`[ligis-croo] accepted negotiation ${negotiationId} (service: ${serviceId})`);
    } catch (err) {
      console.error(`[ligis-croo] accept failed:`, err);
    }
  }

  /**
   * Run a handler with a timeout. If the handler doesn't complete
   * within HANDLER_TIMEOUT_MS, reject with a timeout error so the
   * provider can deliver an error payload instead of hanging forever.
   */
  private async runHandlerWithTimeout(
    handler: (req: ServiceRequest) => Promise<ServiceResult>,
    request: ServiceRequest,
  ): Promise<ServiceResult> {
    return new Promise<ServiceResult>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)),
        HANDLER_TIMEOUT_MS,
      );
      handler(request)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private async onOrderPaid(
    orderId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
  ): Promise<void> {
    if (this.fulfilledOrders.has(orderId)) {
      console.log(
        `[ligis-croo] order ${orderId} already fulfilled — skipping duplicate OrderPaid`,
      );
      return;
    }
    if (this.inFlight.has(orderId)) {
      console.log(
        `[ligis-croo] order ${orderId} already in flight — skipping duplicate OrderPaid`,
      );
      return;
    }
    // Mark as in-flight to prevent concurrent processing of duplicate events.
    this.inFlight.add(orderId);

    console.log(`[ligis-croo] order paid: ${orderId}`);

    // The order_paid event only has order_id + negotiation_id — no
    // service_id or requirements. Try the cache first (populated when
    // we accepted the negotiation), then fall back to the API.
    const negotiationId: string | undefined =
      event.negotiation_id ?? event.negotiationId;
    let rawServiceId: string | undefined = event.service_id ?? event.serviceId;
    let requirements: string | undefined = event.requirements;

    if ((!rawServiceId || !requirements) && negotiationId) {
      const cached = this.negotiationCache.get(negotiationId);
      if (cached) {
        rawServiceId = cached.serviceId;
        requirements = cached.requirements;
      } else {
        try {
          const neg = await this.client.getNegotiation(negotiationId);
          rawServiceId = neg.serviceId;
          requirements = neg.requirements;
        } catch (err) {
          console.error(`[ligis-croo] failed to fetch negotiation ${negotiationId}:`, err);
        }
      }
    }

    const serviceId = rawServiceId ? this.resolveServiceId(rawServiceId) : undefined;
    const service = serviceId ? this.serviceMap.get(serviceId) : undefined;
    if (!service || !requirements) {
      console.error(
        `[ligis-croo] cannot fulfill order ${orderId}: missing service or requirements`,
      );
      this.inFlight.delete(orderId);
      this.errorCount++;
      return;
    }

    try {
      const request: ServiceRequest = { serviceId: service.id, requirements };
      const result = await this.runHandlerWithTimeout(service.handler, request);

      // Log the deliverable payload for debugging (truncated for readability).
      const preview = result.deliverableText.length > 200
        ? result.deliverableText.slice(0, 200) + "…"
        : result.deliverableText;
      console.log(`[ligis-croo] handler result for ${orderId}: ${preview}`);

      // Retry delivery with exponential backoff. Only mark as fulfilled
      // after successful delivery — failed deliveries can be retried
      // by duplicate OrderPaid events or manual intervention.
      let delivered = false;
      for (let attempt = 1; attempt <= MAX_DELIVERY_RETRIES; attempt++) {
        try {
          await this.client.deliverOrder(orderId, {
            deliverableType: result.deliverableType,
            deliverableText: result.deliverableText,
          });
          delivered = true;
          break;
        } catch (deliverErr) {
          console.error(
            `[ligis-croo] delivery attempt ${attempt}/${MAX_DELIVERY_RETRIES} failed for order ${orderId}:`,
            deliverErr,
          );
          if (attempt < MAX_DELIVERY_RETRIES) {
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      if (delivered) {
        // Mark fulfilled only after successful delivery.
        this.fulfilledOrders.add(orderId);
        console.log(`[ligis-croo] delivered order ${orderId}`);
        this.lastDeliveryAt = Date.now();
        this.deliveredCount++;
      } else {
        console.error(
          `[ligis-croo] all ${MAX_DELIVERY_RETRIES} delivery attempts failed for order ${orderId}`,
        );
        this.errorCount++;
      }
    } catch (err) {
      console.error(`[ligis-croo] handler failed for order ${orderId}:`, err);
      this.errorCount++;
      // Deliver an error payload so the buyer gets a response.
      try {
        await this.client.deliverOrder(orderId, {
          deliverableType: "text",
          deliverableText: JSON.stringify({
            error: true,
            message: err instanceof Error ? err.message : String(err),
          }),
        });
        this.fulfilledOrders.add(orderId);
      } catch (deliverErr) {
        console.error(
          `[ligis-croo] failed to deliver error payload:`,
          deliverErr,
        );
      }
    } finally {
      this.inFlight.delete(orderId);
    }
  }

  getService(id: SupportedServiceId): ServiceDescriptor | undefined {
    return this.serviceMap.get(id);
  }

  /**
   * Health snapshot for monitoring. Returns uptime, delivery counts,
   * WebSocket status, and last delivery timestamp.
   */
  health(): {
    uptime: number;
    delivered: number;
    errors: number;
    lastDeliveryAt: number | null;
    wsConnected: boolean;
    inFlight: number;
  } {
    return {
      uptime: Date.now() - this.startedAt,
      delivered: this.deliveredCount,
      errors: this.errorCount,
      lastDeliveryAt: this.lastDeliveryAt || null,
      wsConnected: this.wsConnected,
      inFlight: this.inFlight.size,
    };
  }

  /** Close the idempotency store, clear timers, and release resources. */
  close(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.fulfilledOrders.close();
  }
}
