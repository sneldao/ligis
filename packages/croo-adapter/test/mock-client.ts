import { EventEmitter } from "node:events";
import type { CrooClient, EventStreamLike } from "../src/client.js";

export class MockEventStream extends EventEmitter implements EventStreamLike {
  close = () => {
    this.removeAllListeners();
  };
}

export class MockCrooClient implements CrooClient {
  public calls: Array<{ method: string; args: unknown[] }> = [];
  public stream = new MockEventStream();

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
  }

  async connectWebSocket(): Promise<EventStreamLike> {
    this.record("connectWebSocket", []);
    return this.stream;
  }

  async acceptNegotiation(negotiationId: string) {
    this.record("acceptNegotiation", [negotiationId]);
    return { orderId: `order-${negotiationId}` };
  }

  async rejectNegotiation(negotiationId: string, reason: string) {
    this.record("rejectNegotiation", [negotiationId, reason]);
  }

  async deliverOrder(
    orderId: string,
    req: { deliverableType: string; deliverableText: string },
  ) {
    this.record("deliverOrder", [orderId, req]);
  }

  async negotiateOrder(req: { serviceId: string; requirements: string }) {
    this.record("negotiateOrder", [req]);
    return { negotiationId: "neg-123", orderId: "order-123" };
  }

  async payOrder(orderId: string) {
    this.record("payOrder", [orderId]);
    return { txHash: `0x${orderId}` };
  }

  async getDelivery(orderId: string) {
    this.record("getDelivery", [orderId]);
    return null;
  }

  async getNegotiation(negotiationId: string) {
    this.record("getNegotiation", [negotiationId]);
    return {
      negotiationId,
      serviceId: "ligis.verify",
      requirements: "{}",
      status: "accepted",
    };
  }

  /** Helper to emit events into the provider loop. */
  emitEvent(event: string, payload: unknown) {
    this.stream.emit(event, payload);
  }
}
