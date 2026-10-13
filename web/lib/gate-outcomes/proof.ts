import "server-only";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  http,
  parseAbi,
  type Hex,
} from "viem";

export type ProofObservation = {
  chainId: number;
  txHash: string;
  status: "pending" | "success" | "reverted";
  finalized: boolean;
  blockTime?: number;
  asset?: string;
  payer?: string;
  payee?: string;
  amountBaseUnits?: string;
  logIndex?: number;
};
export type ProofVerifier = (
  txHash: string,
  logIndex: number,
) => Promise<ProofObservation>;
const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

/** Server-selected HTTPS RPC only; clients cannot submit receipt objects/RPCs.
 * Accepts an actual ERC20 Transfer emitted by an operator-allowed asset.
 * For reverted transactions only direct ERC20 transfer calldata is supported.
 * Finalized block tag and canonical receipt block hash are both mandatory. */
export function createRpcProofVerifier(options: {
  url: string;
  chainId: number;
  assets: string[];
  transport?: typeof fetch;
}): ProofVerifier {
  const url = new URL(options.url);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw Error("invalid-rpc-config");
  if (
    ![143, 10143].includes(options.chainId) ||
    options.assets.length === 0 ||
    options.assets.length > 16 ||
    !options.assets.every((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
  )
    throw Error("invalid-rpc-config");
  const assets = new Set(options.assets.map((asset) => asset.toLowerCase()));
  const client = createPublicClient({
    transport: http(options.url, {
      timeout: 1500,
      retryCount: 0,
      fetchFn: options.transport,
    }),
  });
  return async (hash, logIndex) => {
    const txHash = hash as Hex;
    const chainId = await client.getChainId();
    if (chainId !== options.chainId) throw Error("rpc-wrong-chain");
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch (error) {
      // Not-found alone is pending. Other RPC failures must remain unavailable.
      if (
        error instanceof Error &&
        error.name === "TransactionReceiptNotFoundError"
      )
        return { chainId, txHash, status: "pending", finalized: false };
      throw error;
    }
    const [finalized, canonical] = await Promise.all([
      client.getBlock({ blockTag: "finalized" }),
      client.getBlock({ blockNumber: receipt.blockNumber }),
    ]);
    if (
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      canonical.hash !== receipt.blockHash
    )
      throw Error("noncanonical-proof");
    const base: ProofObservation = {
      chainId,
      txHash: receipt.transactionHash,
      status: receipt.status === "success" ? "success" : "reverted",
      finalized:
        finalized.number !== null && finalized.number >= receipt.blockNumber,
      blockTime: Number(canonical.timestamp),
    };
    if (receipt.status === "reverted") {
      const tx = await client.getTransaction({ hash: txHash });
      if (
        !tx.to ||
        !assets.has(tx.to.toLowerCase()) ||
        tx.blockHash !== receipt.blockHash
      )
        return base;
      try {
        const decoded = decodeFunctionData({
          abi: transferAbi,
          data: tx.input,
        });
        if (decoded.functionName !== "transfer") return base;
        return {
          ...base,
          asset: tx.to,
          payer: tx.from,
          payee: decoded.args[0],
          amountBaseUnits: decoded.args[1].toString(),
        };
      } catch {
        return base;
      }
    }
    const log = receipt.logs.find((entry) => entry.logIndex === logIndex);
    if (
      !log ||
      log.removed ||
      log.transactionHash !== receipt.transactionHash ||
      log.blockHash !== receipt.blockHash ||
      !assets.has(log.address.toLowerCase())
    )
      return base;
    try {
      const decoded = decodeEventLog({
        abi: transferAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      return {
        ...base,
        asset: log.address,
        payer: decoded.args.from,
        payee: decoded.args.to,
        amountBaseUnits: decoded.args.value.toString(),
        logIndex,
      };
    } catch {
      return base;
    }
  };
}
