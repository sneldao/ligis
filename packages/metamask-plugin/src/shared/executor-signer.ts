/**
 * Bridge from the guard's `TypedDataSigner` to the MetaMask Agent Wallet
 * executor (`ctx.walletExecutor(io, commandId)` under `wallet-submit`).
 *
 * The executor accepts `{ kind: "typed-data", chainId, typedData, intent? }`
 * and returns a result object carrying `signature` when MetaMask policy
 * approves — terminal denials throw inside the host. Anything that isn't a
 * signature is a refusal the guard records as `signer-failed`.
 */
import type { TypedDataSigner } from "@ligis/wallet-plugin";

export type ExecutorResult = {
  kind?: string;
  signature?: string;
  status?: string;
  failureDescription?: string;
};

export type WalletExecutor = (
  request: {
    kind: "typed-data";
    chainId: number;
    typedData: {
      domain: unknown;
      types: unknown;
      primaryType: string;
      message: unknown;
    };
    intent?: { action: string; summary: string };
  },
  opts?: { signal?: AbortSignal },
) => Promise<ExecutorResult>;

export function executorSigner(
  executor: WalletExecutor,
  opts: { intentSummary?: string; signal?: AbortSignal } = {},
): TypedDataSigner {
  return async (request) => {
    const result = await executor(
      {
        kind: "typed-data",
        chainId: request.domain.chainId,
        typedData: {
          domain: request.domain,
          types: request.types,
          primaryType: request.primaryType,
          message: request.message,
        },
        intent: {
          action: "ligis.pay",
          summary: opts.intentSummary ?? "Ligis gate-checked payment",
        },
      },
      opts.signal ? { signal: opts.signal } : {},
    );
    if (
      typeof result.signature !== "string" ||
      !result.signature.startsWith("0x")
    ) {
      throw new Error(
        `executor did not return a signature (status ${result.status ?? "unknown"}${result.failureDescription ? `: ${result.failureDescription}` : ""})`,
      );
    }
    return result.signature;
  };
}
