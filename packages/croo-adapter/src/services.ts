/**
 * CROO service catalog for Ligis.
 *
 * Each entry maps a service ID (registered in the CROO Dashboard) to the
 * input/output schema and the handler that fulfills it.
 */

export interface ServiceRequest {
  serviceId: string;
  /** JSON-encoded requirements from the requester */
  requirements: string;
}

export interface ServiceResult {
  /** DeliverableType.Text or DeliverableType.Schema */
  deliverableType: string;
  /** JSON-encoded result */
  deliverableText: string;
}

export type ServiceHandler = (req: ServiceRequest) => Promise<ServiceResult>;

/** Service metadata used for the Agent Store listing and runtime dispatch. */
export interface ServiceDescriptor {
  id: string;
  name: string;
  description: string;
  priceUsd: string;
  inputSchema: object;
  outputSchema: object;
  handler: ServiceHandler;
}

export const SUPPORTED_SERVICES = [
  "ligis.risk",
  "ligis.verify",
  "ligis.issue",
] as const;

export type SupportedServiceId = (typeof SUPPORTED_SERVICES)[number];

export function parseServiceRequirements(requirements: string): unknown {
  try {
    const parsed = JSON.parse(requirements);
    // CROO wraps the buyer's requirements in an envelope. The wrapper
    // key varies — we've seen both { text: "..." } and { deliverableText: "..." }.
    // Detect any single-key object whose value is a JSON string and unwrap it.
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      if (keys.length === 1) {
        const val = (parsed as Record<string, unknown>)[keys[0]];
        if (typeof val === "string") {
          try {
            return JSON.parse(val);
          } catch {
            // Inner value wasn't JSON — return as plain string
            return val;
          }
        }
      }
    }
    return parsed;
  } catch {
    throw new Error("Invalid JSON in negotiation requirements");
  }
}
