/**
 * Mandate parsing — route layer validation for mandate fields.
 *
 * This module is pure parsing / validation with no server-only imports,
 * so it can be unit-tested independently of the route handler.
 */
import type { PaymentIntent } from "./decide";

const MAX_MANDATE_PAYEES = 100;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Parse and validate the mandate object from a request body.
 * Returns a `PaymentIntent.mandate` on success, or an error string on failure.
 */
export function parseMandate(
  mandateRaw: unknown,
): PaymentIntent["mandate"] | string {
  if (mandateRaw === undefined || mandateRaw === null) return undefined;
  if (typeof mandateRaw !== "object") return "mandate must be an object";

  const m = mandateRaw as Record<string, unknown>;
  const out: PaymentIntent["mandate"] = {};
  let error: string | null = null;

  if (m.payees !== undefined) {
    if (!Array.isArray(m.payees)) return "mandate.payees must be an array";
    if (m.payees.length > MAX_MANDATE_PAYEES) {
      return `mandate.payees must have ≤ ${MAX_MANDATE_PAYEES} entries`;
    }
    const arr: string[] = [];
    for (const p of m.payees) {
      const s = asString(p);
      if (!s) return "mandate.payees entries must be non-empty strings";
      arr.push(s);
    }
    out.payees = arr;
  }

  if (m.maxUsd !== undefined) {
    const n = asNumber(m.maxUsd);
    if (n === null || n <= 0) return "mandate.maxUsd must be > 0";
    out.maxUsd = n;
  }

  if (m.expectedUsd !== undefined) {
    const n = asNumber(m.expectedUsd);
    if (n === null || n <= 0) return "mandate.expectedUsd must be > 0";
    out.expectedUsd = n;
  }

  if (m.scope !== undefined) {
    const s = asString(m.scope);
    if (!s) return "mandate.scope must be a non-empty string";
    out.scope = s;
  }

  return error ?? out;
}
