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

/** Maximum time a service handler can run before timing out. */
const HANDLER_TIMEOUT_MS = 30_000;

export interface ProviderOptions {
  client: CrooClient;
  services?: ServiceDescriptor[];
  /**
   * Path to a SQLite file for persistent idempotency tracking.
   * If set, fulfilled orders survive process restarts.
   * If omitted, falls back to in-memory Set (lost on restart).
   */
  idempotencyDbPath?: string;
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
  close(): void;
}

class MemoryIdempotencyStore implements IdempotencyStore {
  private set = new Set<string>();
  has(id: string) { return this.set.has(id); }
  add(id: string) { this.set.add(id); }
  delete(id: string) { this.set.delete(id); }
  close() { this.set.clear(); }
}

class SqliteIdempotencyStore implements IdempotencyStore {
  private db: import("node:sqlite").DatabaseSync;
  private stmtHas: import("node:sqlite").StatementSync;
  private stmtAdd: import("node:sqlite").StatementSync;
  private stmtDel: import("node:sqlite").StatementSync;

  constructor(path: string) {
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
  close(): void {
    this.db.close();
  }
}

export class LigisCrooProvider {
  private client: CrooClient;
  private serviceMap: Map<string, ServiceDescriptor>;
  private fulfilledOrders: IdempotencyStore;
  /** Timestamp of last successful delivery, for health monitoring. */
  private lastDeliveryAt = 0;
  /** Total orders delivered, for health monitoring. */
  private deliveredCount = 0;
  /** Total errors, for health monitoring. */
  private errorCount = 0;

  constructor(opts: ProviderOptions) {
    this.client = opts.client;
    this.serviceMap = new Map(
      (opts.services ?? defaultServices).map((s) => [s.id, s]),
    );
    this.fulfilledOrders = opts.idempotencyDbPath
      ? new SqliteIdempotencyStore(opts.idempotencyDbPath)
      : new MemoryIdempotencyStore();
  }

  /**
   * Start the provider WebSocket loop.
   */
  async start(): Promise<EventStreamLike> {
    const stream = await this.client.connectWebSocket();

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

    return stream;
  }

  private async onNegotiationCreated(
    negotiationId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
  ): Promise<void> {
    console.log(`[ligis-croo] negotiation created: ${negotiationId}`);

    const serviceId: string | undefined = event.service_id ?? event.serviceId;
    const requirements: string | undefined = event.requirements;

    if (!serviceId || !this.serviceMap.has(serviceId)) {
      console.log(`[ligis-croo] rejecting: unsupported service ${serviceId}`);
      await this.client.rejectNegotiation(
        negotiationId,
        `Unsupported service: ${serviceId ?? "unknown"}`,
      );
      return;
    }

    try {
      await this.client.acceptNegotiation(negotiationId);
      console.log(`[ligis-croo] accepted negotiation ${negotiationId}`);
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
    // Claim the order synchronously (before any await) so a duplicate
    // OrderPaid arriving while this one is still in flight sees the claim
    // and skips, instead of racing to a second deliverOrder call.
    this.fulfilledOrders.add(orderId);

    console.log(`[ligis-croo] order paid: ${orderId}`);

    const serviceId: string | undefined = event.service_id ?? event.serviceId;
    const requirements: string | undefined = event.requirements;

    const service = serviceId ? this.serviceMap.get(serviceId) : undefined;
    if (!service || !requirements) {
      console.error(
        `[ligis-croo] cannot fulfill order ${orderId}: missing service or requirements`,
      );
      this.fulfilledOrders.delete(orderId);
      this.errorCount++;
      return;
    }

    try {
      const request: ServiceRequest = { serviceId: service.id, requirements };
      const result = await this.runHandlerWithTimeout(service.handler, request);
      await this.client.deliverOrder(orderId, {
        deliverableType: result.deliverableType,
        deliverableText: result.deliverableText,
      });
      console.log(`[ligis-croo] delivered order ${orderId}`);
      this.lastDeliveryAt = Date.now();
      this.deliveredCount++;
    } catch (err) {
      console.error(`[ligis-croo] delivery failed for order ${orderId}:`, err);
      this.errorCount++;
      try {
        await this.client.deliverOrder(orderId, {
          deliverableType: "text",
          deliverableText: JSON.stringify({
            error: true,
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      } catch (deliverErr) {
        console.error(
          `[ligis-croo] failed to deliver error payload:`,
          deliverErr,
        );
        // Both the primary and error-payload deliveries failed — release the
        // claim so a genuine retry (not just a duplicate event) can succeed.
        this.fulfilledOrders.delete(orderId);
      }
    }
  }

  getService(id: SupportedServiceId): ServiceDescriptor | undefined {
    return this.serviceMap.get(id);
  }

  /**
   * Health snapshot for monitoring. Returns uptime, delivery counts,
   * and last delivery timestamp.
   */
  health(): {
    delivered: number;
    errors: number;
    lastDeliveryAt: number | null;
  } {
    return {
      delivered: this.deliveredCount,
      errors: this.errorCount,
      lastDeliveryAt: this.lastDeliveryAt || null,
    };
  }

  /** Close the idempotency store and release resources. */
  close(): void {
    this.fulfilledOrders.close();
  }
}
