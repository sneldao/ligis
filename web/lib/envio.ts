import "server-only";
import type { Address, Hex } from "viem";
import type { CapabilityChange, IssuanceLog } from "./chain";

/**
 * Free Envio HyperIndex GraphQL endpoint for Monad CredentialRegistry history.
 *
 * Production: HyperIndex on nuncio-vultr (see `packages/envio-indexer`).
 * Set `LIGIS_ENVIO_GRAPHQL_URL` on Vercel / local. When unset, Monad callers
 * fall back to chunked public-RPC `eth_getLogs` (100-block windows).
 */
export function envioGraphqlUrl(): string | undefined {
  const url = process.env.LIGIS_ENVIO_GRAPHQL_URL?.trim();
  return url || undefined;
}

/** True when the web app will prefer Envio for Monad history reads. */
export function envioConfigured(): boolean {
  return Boolean(envioGraphqlUrl());
}

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  const endpoint = envioGraphqlUrl();
  if (!endpoint) return null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      // Short-lived — page renders must not hang on a cold indexer.
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 15 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as GraphqlResponse<T>;
    if (body.errors?.length || !body.data) return null;
    return body.data;
  } catch {
    return null;
  }
}

type IssuedRow = {
  id: string;
  issuer: string;
  subject: string;
  capabilityHash: string;
  blockNumber: string;
  txHash: string;
  logIndex: number;
};

type CapChangeRow = {
  id: string;
  subject: string;
  capabilityHash: string;
  capable: boolean;
  blockNumber: string;
  txHash: string;
  logIndex: number;
};

/**
 * Issuer activity from Envio. Returns `null` when the endpoint is unset or
 * the query fails — callers should fall back to RPC scanning.
 */
export async function readIssuerActivityFromEnvio(): Promise<IssuanceLog | null> {
  const data = await graphql<{ CredentialIssued: IssuedRow[] }>(`
    query IssuerActivity {
      CredentialIssued(order_by: { blockNumber: desc }, limit: 500) {
        id
        issuer
        subject
        capabilityHash
        blockNumber
        txHash
        logIndex
      }
    }
  `);
  if (!data) return null;

  const rows = data.CredentialIssued ?? [];
  const tally = new Map<Address, { count: number; lastSeen: bigint }>();
  let minBlock = 0n;
  let maxBlock = 0n;

  for (const row of rows) {
    const issuer = row.issuer as Address;
    const block = BigInt(row.blockNumber);
    if (minBlock === 0n || block < minBlock) minBlock = block;
    if (block > maxBlock) maxBlock = block;
    const prev = tally.get(issuer);
    tally.set(issuer, {
      count: (prev?.count ?? 0) + 1,
      lastSeen: prev && prev.lastSeen > block ? prev.lastSeen : block,
    });
  }

  const issuers = Array.from(tally.entries())
    .map(([issuer, v]) => ({ issuer, count: v.count, lastSeen: v.lastSeen }))
    .sort((a, b) => b.count - a.count || (b.lastSeen > a.lastSeen ? 1 : -1));

  return {
    blockRange: { from: minBlock, to: maxBlock },
    truncated: rows.length >= 500,
    issuers,
    totalIssuances: rows.length,
    unavailable: false,
    source: "envio",
  };
}

/**
 * Capability history for a subject from Envio. Returns `null` on miss/failure.
 */
export async function readCapabilityHistoryFromEnvio(
  subject: Address,
): Promise<CapabilityChange[] | null> {
  const data = await graphql<{ AgentCapabilityChanged: CapChangeRow[] }>(
    `
      query CapHistory($subject: String!) {
        AgentCapabilityChanged(
          where: { subject: { _eq: $subject } }
          order_by: { blockNumber: desc }
          limit: 200
        ) {
          id
          subject
          capabilityHash
          capable
          blockNumber
          txHash
          logIndex
        }
      }
    `,
    { subject: subject.toLowerCase() },
  );
  if (!data) return null;

  return (data.AgentCapabilityChanged ?? []).map((row) => ({
    capabilityHash: row.capabilityHash as Hex,
    capable: row.capable,
    blockNumber: BigInt(row.blockNumber),
    txHash: row.txHash as Hex,
    logIndex: row.logIndex,
  }));
}
