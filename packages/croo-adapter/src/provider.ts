import { EventType } from "@croo-network/sdk";
import { handleVerify } from "./verify.js";
import { handleIssue } from "./issue.js";
import type { CrooClient, EventStreamLike } from "./client.js";
import {
  type ServiceDescriptor,
  type ServiceRequest,
  type SupportedServiceId,
  SUPPORTED_SERVICES,
} from "./services.js";

export interface ProviderOptions {
  client: CrooClient;
  services?: ServiceDescriptor[];
}

/**
 * Default Ligis services offered on CROO.
 *
 * Register these service IDs in the CROO Dashboard when creating your agent.
 */
export const defaultServices: ServiceDescriptor[] = [
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

export class LigisCrooProvider {
  private client: CrooClient;
  private serviceMap: Map<string, ServiceDescriptor>;

  constructor(opts: ProviderOptions) {
    this.client = opts.client;
    this.serviceMap = new Map(
      (opts.services ?? defaultServices).map((s) => [s.id, s]),
    );
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

  private async onOrderPaid(
    orderId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
  ): Promise<void> {
    console.log(`[ligis-croo] order paid: ${orderId}`);

    const serviceId: string | undefined = event.service_id ?? event.serviceId;
    const requirements: string | undefined = event.requirements;

    const service = serviceId ? this.serviceMap.get(serviceId) : undefined;
    if (!service || !requirements) {
      console.error(
        `[ligis-croo] cannot fulfill order ${orderId}: missing service or requirements`,
      );
      return;
    }

    try {
      const request: ServiceRequest = { serviceId: service.id, requirements };
      const result = await service.handler(request);
      await this.client.deliverOrder(orderId, {
        deliverableType: result.deliverableType,
        deliverableText: result.deliverableText,
      });
      console.log(`[ligis-croo] delivered order ${orderId}`);
    } catch (err) {
      console.error(`[ligis-croo] delivery failed for order ${orderId}:`, err);
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
      }
    }
  }

  getService(id: SupportedServiceId): ServiceDescriptor | undefined {
    return this.serviceMap.get(id);
  }
}
