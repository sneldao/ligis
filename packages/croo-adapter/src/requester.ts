import { EventType } from "@croo-network/sdk";
import type { CrooClient } from "./client.js";

export interface RequesterOptions {
  client: CrooClient;
  serviceId: string;
}

/**
 * A simple CROO requester that hires a Ligis-capable agent to verify a credential.
 *
 * Usage:
 *   const requester = new LigisCrooRequester({ client, serviceId: "ligis.verify" });
 *   const result = await requester.verifyCredential({
 *     subject: "did:ligis:casper:...",
 *     capability: "agent.commerce.escrow",
 *   });
 */
export class LigisCrooRequester {
  private client: CrooClient;
  private serviceId: string;

  constructor(opts: RequesterOptions) {
    this.client = opts.client;
    this.serviceId = opts.serviceId;
  }

  /**
   * Start the requester WebSocket loop and wait for a single order to complete.
   */
  async startAndWait(requirements: object): Promise<string> {
    const stream = await this.client.connectWebSocket();

    return new Promise((resolve, reject) => {
      const onCompleted = async (event: { order_id?: string }) => {
        const orderId = event.order_id;
        if (!orderId) return;
        try {
          const delivery = await this.client.getDelivery(orderId);
          resolve(delivery?.deliverableText ?? "{}");
        } catch (err) {
          reject(err);
        } finally {
          stream.close?.();
        }
      };

      stream.on(EventType.OrderCreated, (async (event: {
        order_id?: string;
      }) => {
        const orderId = event.order_id;
        if (!orderId) return;
        try {
          await this.client.payOrder(orderId);
        } catch (err) {
          reject(err);
        }
      }) as (...args: unknown[]) => void);

      stream.on(
        EventType.OrderCompleted,
        onCompleted as (...args: unknown[]) => void,
      );

      this.client
        .negotiateOrder({
          serviceId: this.serviceId,
          requirements: JSON.stringify(requirements),
        })
        .catch(reject);
    });
  }

  /**
   * Convenience method: verify a credential and return the parsed result.
   */
  async verifyCredential(requirements: {
    subject: string;
    capability: string;
    issuer?: string;
  }): Promise<{
    capable: boolean;
    capabilityHash: string;
    latestCredential?: unknown;
  }> {
    const text = await this.startAndWait(requirements);
    const parsed = JSON.parse(text);
    return {
      capable: Boolean(parsed.capable),
      capabilityHash: String(parsed.capabilityHash ?? ""),
      latestCredential: parsed.latestCredential,
    };
  }
}
