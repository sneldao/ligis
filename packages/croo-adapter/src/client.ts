import { AgentClient, type Config as CrooSdkConfig } from "@croo-network/sdk";

/**
 * Minimal event stream interface used by the provider and requester.
 *
 * The real @croo-network/sdk EventStream extends EventEmitter; this type
 * lets tests inject a plain EventEmitter without importing SDK internals.
 */
export interface EventStreamLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): boolean;
  close?: () => void;
}

/**
 * Thin wrapper around @croo-network/sdk AgentClient.
 *
 * We wrap it so tests can inject a mock implementation, and so the provider
 * code depends on our interface rather than the SDK directly.
 */
export interface CrooClient {
  connectWebSocket(): Promise<EventStreamLike>;
  acceptNegotiation(negotiationId: string): Promise<{ orderId?: string }>;
  rejectNegotiation(negotiationId: string, reason: string): Promise<void>;
  deliverOrder(
    orderId: string,
    req: { deliverableType: string; deliverableText: string },
  ): Promise<void>;
  negotiateOrder(req: {
    serviceId: string;
    requirements: string;
  }): Promise<{ negotiationId?: string; orderId?: string }>;
  payOrder(orderId: string): Promise<{ txHash?: string }>;
  getDelivery(orderId: string): Promise<{ deliverableText?: string } | null>;
  /** Fetch negotiation details (includes requirements + serviceId). */
  getNegotiation(negotiationId: string): Promise<{
    negotiationId: string;
    serviceId: string;
    requirements: string;
    status: string;
  }>;
}

export function createCrooClient(
  config: CrooSdkConfig,
  sdkKey: string,
): CrooClient {
  return new AgentClient(config, sdkKey) as unknown as CrooClient;
}
