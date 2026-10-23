import "server-only";
import { readErc8004Evidence, type Erc8004Options } from "./erc8004";
import { readNansenEvidence, type NansenOptions } from "./nansen";
import {
  readSettlementEvidence,
  type SettlementBinding,
  type SettlementSource,
} from "./settlements";
import {
  boundedRead,
  evidenceTimeout,
  unavailable,
  type EvidenceOptions,
  type EvidenceReader,
  type PayeeEvidence,
} from "./types";

export type {
  PayeeEvidence,
  EvidenceOptions,
  EvidenceReader,
  PayeeEvidenceReader,
} from "./types";

export type PayeeEvidenceOptions = EvidenceOptions & {
  erc8004?: Erc8004Options;
  nansen?: NansenOptions;
  settlementBinding?: SettlementBinding;
  settlementSource?: SettlementSource;
  /** Test/coordinate seam: replace the env-configured reader wholesale. */
  readNansenEvidence?: EvidenceReader;
};

const positiveInt = (value: string | undefined): number | undefined => {
  const n = Number(value?.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/**
 * Nansen offers one Monad chain, named `monad`, and its response carries no
 * chain id, so mainnet-vs-testnet cannot be proven from the API. The operator
 * must confirm the mapping; without it — or without an intended network for
 * this payee — the reader answers `nansen-chain-unconfirmed` and never calls
 * the provider. Never fall back to the confirmed id: labels from one network
 * are not evidence about another. The intended network comes from the caller's
 * evidence context, or from the operator-declared chain this gate settles on.
 */
export function nansenConfigFromEnv(
  env: NodeJS.ProcessEnv,
  overrides: NansenOptions = {},
  contextChainId?: number,
): NansenOptions {
  return {
    ...overrides,
    enabled: overrides.enabled ?? env.LIGIS_NANSEN_ENABLED === "1",
    apiKey: overrides.apiKey ?? env.NANSEN_API_KEY?.trim() ?? "",
    confirmedMonadChainId:
      overrides.confirmedMonadChainId ??
      positiveInt(env.LIGIS_NANSEN_MONAD_CHAIN_ID),
    chainId:
      overrides.chainId ??
      contextChainId ??
      positiveInt(env.LIGIS_PAYEE_EVIDENCE_CHAIN_ID),
  };
}

export async function readPayeeEvidence(
  payee: string,
  options: PayeeEvidenceOptions = {},
): Promise<PayeeEvidence[]> {
  const timeoutMs = evidenceTimeout(options.timeoutMs);
  const reads: Array<[PayeeEvidence["source"], EvidenceReader]> = [
    [
      "erc8004",
      (subject, ctx) =>
        readErc8004Evidence(subject, {
          ...options.erc8004,
          env: options.env ?? options.erc8004?.env,
          chainId: options.chainId ?? options.erc8004?.chainId,
          signal: ctx.signal,
          timeoutMs: Math.max(1, timeoutMs - 50),
        }),
    ],
    [
      "x402-settlement",
      (subject, ctx) =>
        readSettlementEvidence(subject, {
          ...ctx,
          timeoutMs: Math.max(1, timeoutMs - 50),
          binding: options.settlementBinding,
          source: options.settlementSource,
        }),
    ],
    [
      "nansen",
      options.readNansenEvidence ??
        (() =>
          readNansenEvidence(
            payee,
            nansenConfigFromEnv(
              options.env ?? process.env,
              {
                ...options.nansen,
                timeoutMs: Math.max(1, timeoutMs - 50),
              },
              options.chainId,
            ),
          )),
    ],
  ];
  return Promise.all(
    reads.map(async ([source, read]) => {
      try {
        const evidence = await boundedRead(
          (signal) => read(payee, { ...options, timeoutMs, signal }),
          timeoutMs,
          options.signal,
        );
        if (evidence.source !== source)
          throw new Error("wrong evidence source");
        return evidence;
      } catch {
        return unavailable(
          source,
          `${source} source did not answer within its read budget`,
          options.chainId,
        );
      }
    }),
  );
}
