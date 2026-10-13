import "server-only";
import { readErc8004Evidence, type Erc8004Options } from "./erc8004";
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
  settlementBinding?: SettlementBinding;
  settlementSource?: SettlementSource;
  /** Worker D can inject its reader without importing an unmerged module. */
  readNansenEvidence?: EvidenceReader;
};

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
        (async () =>
          unavailable(
            "nansen",
            "Nansen reader not configured",
            options.chainId,
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
