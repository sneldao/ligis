import "server-only";
import {
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { getEvmReadContext } from "../chain";
import {
  boundedRead,
  evidenceTimeout,
  unavailable,
  type EvidenceOptions,
  type PayeeEvidence,
} from "./types";

// Official ERC-8004 v2 interfaces, retrieved 2026-10-13. References in docs/payee-evidence.md.
export const IDENTITY_ABI = parseAbi([
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function isAuthorizedOrOwner(address spender, uint256 agentId) view returns (bool)",
]);
export const REPUTATION_ABI = parseAbi([
  "function getIdentityRegistry() view returns (address)",
  "function getClients(uint256 agentId) view returns (address[])",
  "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  "function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
]);
export const REGISTERED_EVENT = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
export const WALLET_EVENT = parseAbiItem(
  "event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)",
);

export type Erc8004Chain = {
  chainId: number;
  networkId: string;
  identity: Address;
  reputation: Address;
  startBlock: bigint;
  explorer: string;
  /** Only hints, never exhaustive discovery. Chain + registry scope is mandatory. */
  seedAgentIds: bigint[];
  ligisScoringWriters: Address[];
};
export const MONAD_ERC8004: Erc8004Chain = {
  chainId: 10143,
  networkId: "monad-testnet",
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  startBlock: 0n,
  explorer: "https://testnet.monadscan.com",
  seedAgentIds: [1974n, 1975n],
  ligisScoringWriters: ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
};

/** Read-only transport. A injected client cannot write through this interface. */
export type Erc8004Rpc = {
  getChainId: () => Promise<number>;
  /** Production returns the finalized block, not Monad's proposed latest tip. */
  getBlockNumber: () => Promise<bigint>;
  readContract: (request: {
    address: Address;
    abi: typeof IDENTITY_ABI | typeof REPUTATION_ABI;
    functionName: string;
    args?: readonly unknown[];
    blockNumber: bigint;
  }) => Promise<unknown>;
  getLogs: (request: {
    address: Address;
    event: typeof REGISTERED_EVENT | typeof WALLET_EVENT;
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<
    Array<{ args: Record<string, unknown>; transactionHash?: Hex | null }>
  >;
};

export type Erc8004Graphql = (
  query: string,
  variables: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;

export type ReputationPolicy = {
  trustedClients: Address[];
  knownControllers?: Address[];
  scoringWriters?: Address[];
  tag1: string;
  tag2: string;
  /** Signed WAD-scaled score. Never use max() or floating point across decimals. */
  minimumValueWad: bigint;
  minimumClients: number;
};
export type Erc8004Options = EvidenceOptions & {
  chain?: Erc8004Chain;
  rpc?: Erc8004Rpc;
  graphql?: Erc8004Graphql;
  reputationPolicy?: ReputationPolicy;
  pageSize?: number;
  maxPages?: number;
  maxAgents?: number;
  maxClients?: number;
  maxFeedbackPerClient?: number;
  rpcWindows?: number;
};
export type Erc8004Feedback = {
  client: Address;
  index: bigint;
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  revoked: boolean;
  independent: boolean;
  trusted: boolean;
  reference: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;
};
export type Erc8004Profile = {
  chainId: number;
  registry: Address;
  agentId: bigint;
  wallet: Address;
  owner: Address;
  agentURI: string;
  isLigisSteward: boolean;
  feedbackCount: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
  feedback: Erc8004Feedback[];
  complete: boolean;
};
export type Erc8004Read = {
  evidence: PayeeEvidence;
  profiles: Erc8004Profile[];
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";
const cap = (n: number | undefined, fallback: number, max: number) =>
  Number.isInteger(n) && n! > 0 ? Math.min(n!, max) : fallback;
const addresses = (s?: string) =>
  (s ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is Address => isAddress(v));

function policyFromEnv(env: NodeJS.ProcessEnv): ReputationPolicy {
  return {
    trustedClients: addresses(env.LIGIS_ERC8004_TRUSTED_CLIENTS),
    knownControllers: addresses(env.LIGIS_ERC8004_KNOWN_CONTROLLERS),
    scoringWriters: addresses(env.LIGIS_ERC8004_SCORING_WRITERS),
    tag1: env.LIGIS_ERC8004_TAG1?.trim() || "delivery",
    tag2: env.LIGIS_ERC8004_TAG2?.trim() || "quality",
    minimumValueWad: 80n * 10n ** 18n,
    minimumClients: 2,
  };
}

function productionRpc(chain: Erc8004Chain): Erc8004Rpc {
  const { client } = getEvmReadContext(chain.networkId);
  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: async () =>
      (await client.getBlock({ blockTag: "finalized" })).number,
    readContract: (request) =>
      client.readContract(request as Parameters<typeof client.readContract>[0]),
    getLogs: async (request) => {
      const logs = await client.getLogs(
        request as Parameters<typeof client.getLogs>[0],
      );
      return logs as unknown as Awaited<ReturnType<Erc8004Rpc["getLogs"]>>;
    },
  };
}

function productionGraphql(env: NodeJS.ProcessEnv): Erc8004Graphql | undefined {
  const url = env.LIGIS_ENVIO_GRAPHQL_URL?.trim();
  if (!url) return undefined;
  return async (query, variables, signal) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error("indexer unavailable");
    const body = await res.json();
    if (body.errors?.length || !body.data)
      throw new Error("indexer schema unavailable");
    return body.data;
  };
}

type WalletRow = {
  id: string;
  agentId: string;
  chainId: number;
  registry: string;
  wallet: string;
};
type CoverageRow = {
  chainId: number;
  registry: string;
  reputation: string;
  fromBlock: string;
  toBlock: string;
};
type ReferenceRow = {
  id: string;
  client: string;
  feedbackIndex: string;
  endpoint: string;
  feedbackURI: string;
  feedbackHash: string;
};

async function discover(
  payee: Address,
  chain: Erc8004Chain,
  rpc: Erc8004Rpc,
  graphql: Erc8004Graphql | undefined,
  block: bigint,
  options: Erc8004Options,
  signal: AbortSignal,
): Promise<{ ids: bigint[]; complete: boolean; limitations: string[] }> {
  const ids = new Set<bigint>();
  const limitations: string[] = [];
  let complete = false;
  const limit = cap(options.pageSize, 100, 200);
  const maxPages = cap(options.maxPages, 5, 10);
  if (graphql) {
    try {
      // Never claim coverage from the newest event. A block handler records sync progress.
      const coverage = (await graphql(
        `
          query Erc8004Coverage($id: String!) {
            Erc8004Coverage(where: { id: { _eq: $id } }) {
              chainId
              registry
              reputation
              fromBlock
              toBlock
            }
          }
        `,
        { id: `${chain.chainId}:${chain.identity.toLowerCase()}` },
        signal,
      )) as { Erc8004Coverage: CoverageRow[] };
      const c = coverage.Erc8004Coverage?.[0];
      const covered = Boolean(
        c &&
        c.chainId === chain.chainId &&
        same(c.registry, chain.identity) &&
        same(c.reputation, chain.reputation) &&
        BigInt(c.fromBlock) <= chain.startBlock &&
        BigInt(c.toBlock) >= block,
      );
      let cursor = "";
      for (let page = 0; page < maxPages; page++) {
        signal.throwIfAborted();
        const data = (await graphql(
          `
            query Erc8004Wallets(
              $chainId: Int!
              $registry: String!
              $wallet: String!
              $cursor: String!
              $limit: Int!
            ) {
              Erc8004WalletBinding(
                where: {
                  chainId: { _eq: $chainId }
                  registry: { _eq: $registry }
                  wallet: { _eq: $wallet }
                  id: { _gt: $cursor }
                }
                order_by: { id: asc }
                limit: $limit
              ) {
                id
                agentId
                chainId
                registry
                wallet
              }
            }
          `,
          {
            chainId: chain.chainId,
            registry: chain.identity.toLowerCase(),
            wallet: payee.toLowerCase(),
            cursor,
            limit,
          },
          signal,
        )) as { Erc8004WalletBinding: WalletRow[] };
        if (!Array.isArray(data.Erc8004WalletBinding))
          throw new Error("missing wallet table");
        const rows = data.Erc8004WalletBinding;
        for (const row of rows) {
          if (
            row.chainId !== chain.chainId ||
            !same(row.registry, chain.identity) ||
            !same(row.wallet, payee)
          ) {
            throw new Error("wrong indexer scope");
          }
          ids.add(BigInt(row.agentId));
        }
        if (rows.length < limit) {
          complete = covered;
          break;
        }
        const next = rows.at(-1)!.id;
        if (next <= cursor)
          throw new Error("non-progressing indexer pagination");
        cursor = next;
      }
      if (!complete)
        limitations.push(
          "indexer coverage is incomplete, stale, or pagination was bounded",
        );
    } catch {
      limitations.push(
        "ERC-8004 indexer unavailable or incompatible; bounded RPC fallback used",
      );
    }
  }
  if (!complete) {
    // Public Monad getLogs accepts only 100-block windows. This is discovery, not full history.
    let to = block;
    let scannedFrom = block + 1n;
    for (
      let i = 0;
      i < cap(options.rpcWindows, 3, 10) && to >= chain.startBlock;
      i++
    ) {
      signal.throwIfAborted();
      const from = to - chain.startBlock >= 99n ? to - 99n : chain.startBlock;
      const logs = await Promise.all([
        rpc.getLogs({
          address: chain.identity,
          event: REGISTERED_EVENT,
          args: { owner: payee },
          fromBlock: from,
          toBlock: to,
        }),
        rpc.getLogs({
          address: chain.identity,
          event: WALLET_EVENT,
          args: { indexedMetadataKey: "agentWallet" },
          fromBlock: from,
          toBlock: to,
        }),
      ]);
      if (logs.some((list) => list.length > 200)) {
        limitations.push("RPC event result exceeds the local processing bound");
        break;
      }
      for (const log of logs[0])
        if (log.args.agentId !== undefined)
          ids.add(BigInt(String(log.args.agentId)));
      for (const log of logs[1]) {
        if (
          log.args.metadataKey === "agentWallet" &&
          same(String(log.args.metadataValue), payee) &&
          log.args.agentId !== undefined
        ) {
          ids.add(BigInt(String(log.args.agentId)));
        }
      }
      scannedFrom = from;
      if (from === chain.startBlock) break;
      to = from - 1n;
    }
    complete = scannedFrom === chain.startBlock;
    if (!complete)
      limitations.push(
        "bounded RPC discovery does not cover the full registry",
      );
  }
  for (const id of chain.seedAgentIds) ids.add(id);
  return { ids: [...ids], complete, limitations };
}

async function references(
  chain: Erc8004Chain,
  agentId: bigint,
  graphql: Erc8004Graphql | undefined,
  options: Erc8004Options,
  signal: AbortSignal,
): Promise<Map<string, ReferenceRow>> {
  const out = new Map<string, ReferenceRow>();
  if (!graphql) return out;
  const limit = cap(options.pageSize, 100, 200);
  let cursor = "";
  for (let page = 0; page < cap(options.maxPages, 5, 10); page++) {
    const data = (await graphql(
      `
        query Erc8004References(
          $chainId: Int!
          $registry: String!
          $agentId: numeric!
          $cursor: String!
          $limit: Int!
        ) {
          Erc8004Feedback(
            where: {
              chainId: { _eq: $chainId }
              registry: { _eq: $registry }
              agentId: { _eq: $agentId }
              id: { _gt: $cursor }
            }
            order_by: { id: asc }
            limit: $limit
          ) {
            id
            client
            feedbackIndex
            endpoint
            feedbackURI
            feedbackHash
          }
        }
      `,
      {
        chainId: chain.chainId,
        registry: chain.reputation.toLowerCase(),
        agentId: agentId.toString(),
        cursor,
        limit,
      },
      signal,
    )) as { Erc8004Feedback: ReferenceRow[] };
    const rows = data.Erc8004Feedback;
    if (!Array.isArray(rows)) throw new Error("missing feedback references");
    for (const row of rows)
      out.set(`${row.client.toLowerCase()}:${row.feedbackIndex}`, row);
    if (rows.length < limit) break;
    const next = rows.at(-1)!.id;
    if (next <= cursor) throw new Error("non-progressing reference pagination");
    cursor = next;
  }
  return out;
}

export async function readErc8004Evidence(
  payee: string,
  options: Erc8004Options = {},
): Promise<PayeeEvidence> {
  return (await readErc8004(payee, options)).evidence;
}

/** Multiple identities per wallet; every candidate is re-bound at one finalized snapshot. */
export async function readErc8004(
  payee: string,
  options: Erc8004Options = {},
): Promise<Erc8004Read> {
  const chain = options.chain ?? MONAD_ERC8004;
  const env = options.env ?? process.env;
  let observedNegative: Erc8004Feedback | undefined;
  if (
    !isAddress(payee) ||
    (options.chainId !== undefined && options.chainId !== chain.chainId)
  ) {
    return {
      profiles: [],
      evidence: unavailable(
        "erc8004",
        "no ERC-8004 reader configured for this address/chain",
        options.chainId,
      ),
    };
  }
  try {
    return await boundedRead(
      async (signal) => {
        const rpc = options.rpc ?? productionRpc(chain);
        const graphql = options.graphql ?? productionGraphql(env);
        const policy = options.reputationPolicy ?? policyFromEnv(env);
        if ((await rpc.getChainId()) !== chain.chainId)
          throw new Error("wrong RPC chain");
        const block = await rpc.getBlockNumber();
        const read = (
          address: Address,
          abi: typeof IDENTITY_ABI | typeof REPUTATION_ABI,
          functionName: string,
          args: readonly unknown[] = [],
        ) => {
          signal.throwIfAborted();
          return rpc.readContract({
            address,
            abi,
            functionName,
            args,
            blockNumber: block,
          });
        };
        if (
          !same(
            String(
              await read(
                chain.reputation,
                REPUTATION_ABI,
                "getIdentityRegistry",
              ),
            ),
            chain.identity,
          )
        ) {
          throw new Error("wrong reputation/identity binding");
        }
        const discovered = await discover(
          payee as Address,
          chain,
          rpc,
          graphql,
          block,
          options,
          signal,
        );
        const limitations = [
          ...discovered.limitations,
          "distinct client addresses are not Sybil resistance",
        ];
        const maxAgents = cap(options.maxAgents, 10, 20);
        let complete =
          discovered.complete && discovered.ids.length <= maxAgents;
        let unavailableRead = false;
        if (discovered.ids.length > maxAgents)
          limitations.push("agent identity candidates truncated");
        const profiles: Erc8004Profile[] = [];
        const trusted = new Set(
          policy.trustedClients.map((v) => v.toLowerCase()),
        );
        const excluded = new Set(
          [
            payee,
            ...(policy.knownControllers ?? []),
            ...chain.ligisScoringWriters,
            ...(policy.scoringWriters ?? []),
          ].map((v) => v.toLowerCase()),
        );
        for (const id of discovered.ids.slice(0, maxAgents)) {
          let profile: Erc8004Profile | undefined;
          try {
            let wallet: Address;
            try {
              wallet = (await read(
                chain.identity,
                IDENTITY_ABI,
                "getAgentWallet",
                [id],
              )) as Address;
            } catch {
              // A failed seed read is still a coverage gap, never evidence of absence.
              complete = false;
              unavailableRead = true;
              limitations.push(
                `wallet binding unavailable for scoped agent ${id}`,
              );
              continue;
            }
            if (same(wallet, ZERO) || !same(wallet, payee)) continue;
            const [owner, uri, clientsRaw] = await Promise.all([
              read(chain.identity, IDENTITY_ABI, "ownerOf", [
                id,
              ]) as Promise<Address>,
              read(chain.identity, IDENTITY_ABI, "tokenURI", [
                id,
              ]) as Promise<string>,
              read(chain.reputation, REPUTATION_ABI, "getClients", [
                id,
              ]) as Promise<Address[]>,
            ]);
            const clients = [
              ...new Set(clientsRaw.map((c) => c.toLowerCase())),
            ] as Address[];
            const maxClients = cap(options.maxClients, 20, 40);
            let profileComplete = clients.length <= maxClients;
            const refs = await references(
              chain,
              id,
              graphql,
              options,
              signal,
            ).catch(() => new Map<string, ReferenceRow>());
            const feedback: Erc8004Feedback[] = [];
            profile = {
              chainId: chain.chainId,
              registry: chain.identity,
              agentId: id,
              wallet,
              owner,
              agentURI: uri,
              isLigisSteward:
                chain.chainId === 10143 &&
                same(chain.identity, MONAD_ERC8004.identity) &&
                id === 1974n,
              feedbackCount: 0n,
              summaryValue: 0n,
              summaryValueDecimals: 18,
              feedback,
              complete: profileComplete,
            };
            profiles.push(profile);
            for (const client of clients.slice(0, maxClients)) {
              const [last, authorized] = await Promise.all([
                read(chain.reputation, REPUTATION_ABI, "getLastIndex", [
                  id,
                  client,
                ]) as Promise<bigint>,
                read(chain.identity, IDENTITY_ABI, "isAuthorizedOrOwner", [
                  client,
                  id,
                ]) as Promise<boolean>,
              ]);
              const maxFeedback = cap(options.maxFeedbackPerClient, 20, 50);
              if (last > BigInt(maxFeedback)) profileComplete = false;
              for (
                let index = 1n;
                index <= last && index <= BigInt(maxFeedback);
                index++
              ) {
                const f = (await read(
                  chain.reputation,
                  REPUTATION_ABI,
                  "readFeedback",
                  [id, client, index],
                )) as [bigint, number, string, string, boolean];
                if (!Number.isInteger(f[1]) || f[1] < 0 || f[1] > 18)
                  throw new Error("invalid feedback decimals");
                const ref = refs.get(`${client.toLowerCase()}:${index}`);
                feedback.push({
                  client,
                  index,
                  value: f[0],
                  valueDecimals: f[1],
                  tag1: f[2],
                  tag2: f[3],
                  revoked: f[4],
                  independent:
                    !authorized &&
                    !same(client, owner) &&
                    !excluded.has(client.toLowerCase()),
                  trusted: trusted.has(client.toLowerCase()),
                  reference: `eip155:${chain.chainId}:${chain.identity.toLowerCase()}:${id}/feedback/${client}/${index}`,
                  endpoint: ref?.endpoint,
                  feedbackURI: ref?.feedbackURI,
                  feedbackHash: ref?.feedbackHash,
                });
                const latest = feedback.at(-1)!;
                if (
                  !latest.revoked &&
                  latest.independent &&
                  latest.trusted &&
                  latest.tag1 === policy.tag1 &&
                  latest.tag2 === policy.tag2 &&
                  ![latest.tag1, latest.tag2].some((tag) =>
                    /ligis[.]gate|gate[-.]preview/i.test(tag),
                  ) &&
                  latest.value * 10n ** BigInt(18 - latest.valueDecimals) <
                    policy.minimumValueWad
                ) {
                  observedNegative = latest;
                }
              }
            }
            complete &&= profileComplete;
            if (!profileComplete)
              limitations.push(
                `feedback coverage incomplete for scoped agent ${id}`,
              );
            const active = feedback.filter((f) => !f.revoked);
            // Display-only summary, never eligibility: no getSummary over untrusted clients.
            const averageWad = active.length
              ? active.reduce(
                  (sum, f) =>
                    sum + f.value * 10n ** BigInt(18 - f.valueDecimals),
                  0n,
                ) / BigInt(active.length)
              : 0n;
            Object.assign(profile, {
              feedbackCount: BigInt(active.length),
              summaryValue: averageWad,
              complete: profileComplete,
            });
          } catch {
            complete = false;
            unavailableRead = true;
            if (profile) profile.complete = false;
            limitations.push(
              `identity/reputation reads unavailable for scoped agent ${id}`,
            );
          }
        }
        const considered = profiles
          .flatMap((p) => p.feedback)
          .filter(
            (f) =>
              !f.revoked &&
              f.independent &&
              f.trusted &&
              f.tag1 === policy.tag1 &&
              f.tag2 === policy.tag2 &&
              ![f.tag1, f.tag2].some((tag) =>
                /ligis[.]gate|gate[-.]preview/i.test(tag),
              ),
          );
        const negative =
          observedNegative ??
          considered.find(
            (f) =>
              f.value * 10n ** BigInt(18 - f.valueDecimals) <
              policy.minimumValueWad,
          );
        const qualifyingClients = new Set(
          considered
            .filter(
              (f) =>
                f.value * 10n ** BigInt(18 - f.valueDecimals) >=
                policy.minimumValueWad,
            )
            .map((f) => f.client.toLowerCase()),
        );
        const validPolicy =
          policy.minimumValueWad > 0n &&
          Number.isInteger(policy.minimumClients) &&
          policy.minimumClients >= 2;
        const positive =
          !negative &&
          complete &&
          validPolicy &&
          qualifyingClients.size >= policy.minimumClients;
        if (!trusted.size)
          limitations.push(
            "no operator-configured trusted independent client set",
          );
        if (!complete)
          limitations.push(
            "unknown coverage cannot positively establish trust",
          );
        limitations.push(
          "feedback URIs are untrusted references; their content is not fetched or verified",
        );
        return {
          profiles,
          evidence: {
            source: "erc8004",
            status: negative
              ? "negative"
              : unavailableRead
                ? "unavailable"
                : positive
                  ? "positive"
                  : "unknown",
            reason: negative
              ? "non-revoked negative delivery feedback from a trusted independent client"
              : unavailableRead
                ? "some identity/reputation reads did not answer"
                : positive
                  ? "qualifying delivery feedback from the operator-configured independent client set"
                  : profiles.length
                    ? "identity is registered; qualifying independent delivery evidence is not established"
                    : "no current agent-wallet binding found in the queried coverage",
            observedAt: new Date().toISOString(),
            chainId: chain.chainId,
            reference:
              negative?.reference ??
              (profiles[0]
                ? `eip155:${chain.chainId}:${chain.identity.toLowerCase()}:${profiles[0].agentId}@${block}`
                : `eip155:${chain.chainId}:${chain.identity.toLowerCase()}@${block}`),
            limitations: [...new Set(limitations)],
          },
        } satisfies Erc8004Read;
      },
      evidenceTimeout(options.timeoutMs),
      options.signal,
    );
  } catch {
    if (observedNegative)
      return {
        profiles: [],
        evidence: {
          source: "erc8004",
          status: "negative",
          reason:
            "trusted independent negative delivery feedback observed before another read failed",
          observedAt: new Date().toISOString(),
          chainId: chain.chainId,
          reference: observedNegative.reference,
          limitations: [
            "remaining ERC-8004 reads unavailable or timed out; negative evidence retained",
          ],
        },
      };
    return {
      profiles: [],
      evidence: unavailable(
        "erc8004",
        "ERC-8004 source unavailable, timed out, or failed chain/registry checks",
        chain.chainId,
      ),
    };
  }
}
