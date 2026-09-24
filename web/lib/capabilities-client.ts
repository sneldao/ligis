/**
 * Client-safe capability catalog (ids only). Avoids importing server-only
 * `web/lib/chain.ts` into client components like GateFormShell.
 */
import credentialsRef from "../../assets/credentials.example.json";

export const capabilities: ReadonlyArray<{ id: string; label: string }> =
  credentialsRef.capabilities.map((c) => ({ id: c.id, label: c.label }));
