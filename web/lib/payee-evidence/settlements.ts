import "server-only";
import type { Address, Hex } from "viem";
import {
  boundedRead,
  evidenceTimeout,
  unavailable,
  type EvidenceOptions,
  type PayeeEvidence,
} from "./types";

export type SettlementBinding = {
  chainId: number;
  asset: Address;
  payer: Address;
  recipient: Address;
  amountBaseUnits: bigint;
};

export type SettlementCandidate = SettlementBinding & {
  transactionHash: Hex;
  facilitator: string;
  authorizationReference: string;
};

/** A trusted adapter must prove facilitator AND authorization provenance.
 * A decoded ERC20 Transfer or a caller-provided "verified" flag is not proof.
 * Implementations must not settle payments or publish feedback.
 */
export type SettlementSource = {
  list: (payee: string, signal: AbortSignal) => Promise<SettlementCandidate[]>;
  verifyProvenance: (
    candidate: SettlementCandidate,
    signal: AbortSignal,
  ) => Promise<boolean>;
  receipt: (
    tx: Hex,
    signal: AbortSignal,
  ) => Promise<{
    chainId: number;
    transactionHash: Hex;
    status: "success" | "reverted";
    blockNumber: bigint;
    blockHash: Hex;
    transfers: Array<{
      asset: Address;
      from: Address;
      to: Address;
      amount: bigint;
    }>;
  }>;
  finalizedBlock: (
    signal: AbortSignal,
  ) => Promise<{ chainId: number; number: bigint }>;
  /** Verify the receipt's block is still canonical, not merely old enough. */
  canonicalBlockHash: (block: bigint, signal: AbortSignal) => Promise<Hex>;
};

export async function readSettlementEvidence(
  payee: string,
  options: EvidenceOptions & {
    binding?: SettlementBinding;
    source?: SettlementSource;
  } = {},
): Promise<PayeeEvidence> {
  const { binding, source } = options;
  if (!binding || !source) {
    return unavailable(
      "x402-settlement",
      !source
        ? "no verified x402 settlement source configured"
        : "chain, asset, payer, recipient and base-unit amount are required; USD is insufficient",
      binding?.chainId,
    );
  }
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    !same(payee, binding.recipient) ||
    binding.amountBaseUnits <= 0n ||
    (options.chainId !== undefined && options.chainId !== binding.chainId)
  ) {
    return unavailable(
      "x402-settlement",
      "settlement context does not bind this payee",
      binding.chainId,
    );
  }
  try {
    return await boundedRead(
      async (signal) => {
        const candidates = await source.list(payee, signal);
        const limitations = [
          "history volume is not independent trust or a capability",
        ];
        if (candidates.length > 20)
          limitations.push("settlement history truncated at 20 candidates");
        let verified = 0;
        let reference: string | undefined;
        for (const c of candidates.slice(0, 20)) {
          signal.throwIfAborted();
          if (
            c.chainId !== binding.chainId ||
            !same(c.asset, binding.asset) ||
            !same(c.payer, binding.payer) ||
            !same(c.recipient, binding.recipient) ||
            c.amountBaseUnits !== binding.amountBaseUnits ||
            !c.facilitator ||
            !c.authorizationReference
          )
            continue;
          if (!(await source.verifyProvenance(c, signal))) continue;
          const [receipt, final] = await Promise.all([
            source.receipt(c.transactionHash, signal),
            source.finalizedBlock(signal),
          ]);
          if (
            receipt.chainId !== binding.chainId ||
            final.chainId !== binding.chainId ||
            !same(receipt.transactionHash, c.transactionHash) ||
            receipt.status !== "success" ||
            receipt.blockNumber > final.number ||
            !receipt.transfers.some(
              (t) =>
                same(t.asset, binding.asset) &&
                same(t.from, binding.payer) &&
                same(t.to, binding.recipient) &&
                t.amount === binding.amountBaseUnits,
            ) ||
            !same(
              await source.canonicalBlockHash(receipt.blockNumber, signal),
              receipt.blockHash,
            )
          )
            continue;
          verified++;
          reference = c.transactionHash;
        }
        return {
          source: "x402-settlement",
          status: verified ? "positive" : "unknown",
          reason: verified
            ? `${verified} provenance-verified, successful, finalized x402 settlement(s) match the internal binding`
            : "no verified x402 settlement matches the internal binding",
          observedAt: new Date().toISOString(),
          chainId: binding.chainId,
          reference,
          limitations,
        };
      },
      evidenceTimeout(options.timeoutMs),
      options.signal,
    );
  } catch {
    return unavailable(
      "x402-settlement",
      "verified settlement source did not answer",
      binding.chainId,
    );
  }
}
