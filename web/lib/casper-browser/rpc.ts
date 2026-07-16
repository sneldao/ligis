/**
 * Browser-side Casper JSON-RPC client.
 *
 * Goes through the `web/app/api/casper-rpc` Next.js route handler, which
 * is a stateless byte-shim that forwards JSON-RPC envelopes to the
 * public Casper Testnet RPC. The browser cannot reach the public RPC
 * directly because it returns 403 on OPTIONS preflight (no CORS support).
 *
 * All methods return parsed JSON; `rpcPutTransaction` accepts the raw
 * bytes from a signed Casper TransactionV1 and forwards them to the
 * upstream `account_put_transaction` JSON-RPC method.
 */

const PROXY_PATH = "/api/casper-rpc";

declare global {
  interface Window {
    __LIGIS_CASPER_PROXY__?: string;
  }
}

function proxyUrl(): string {
  if (typeof window === "undefined") return PROXY_PATH;
  // Allow override for tests / non-standard deploys.
  const override = (window as Window).__LIGIS_CASPER_PROXY__;
  if (typeof override === "string" && override.length > 0) return override;
  return PROXY_PATH;
}

interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface RpcResponse<T> {
  jsonrpc?: "2.0";
  id?: unknown;
  result?: T;
  error?: RpcError;
}

export class CasperJsonRpcError extends Error {
  public readonly code: number;
  public readonly data?: unknown;
  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "CasperJsonRpcError";
    this.code = code;
    this.data = data;
  }
}

/** Low-level JSON-RPC call. Throws CasperJsonRpcError on non-2.0 responses. */
export async function rpcCall<T = unknown>(
  method: string,
  params: unknown,
  id: unknown = 1,
): Promise<T> {
  const res = await fetch(proxyUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new CasperJsonRpcError(`HTTP ${res.status} ${res.statusText}`, res.status);
  }
  const text = await res.text();
  let body: RpcResponse<T>;
  try {
    body = JSON.parse(text) as RpcResponse<T>;
  } catch {
    throw new CasperJsonRpcError(`non-JSON response from proxy: ${text.slice(0, 200)}`, -32700);
  }
  if (body.error) throw new CasperJsonRpcError(body.error.message, body.error.code, body.error.data);
  if (body.result === undefined) {
    throw new CasperJsonRpcError("missing result in response", -32603);
  }
  return body.result;
}

// ---------- Convenience wrappers ----------

/** Fetch the latest state root hash. */
export function getStateRootHash(): Promise<string> {
  return rpcCall<string>("chain_get_state_root_hash", undefined);
}

/** Fetch the latest block info. */
export function getLatestBlockInfo(): Promise<{
  block: { header: { height: string; state_root_hash: string }; body: { transactions: string[] } };
}> {
  return rpcCall("chain_get_block_info", undefined);
}

/** Read the CSPR balance of a public key (in motes, as a decimal string).
 *
 * Tries two Casper 2.0 RPC shapes since the public schema has drifted
 * across testnet versions: (a) the `state_get_balance` + `PurseIdentifier`
 * envelope, (b) `query_global_state` with a path that resolves to the
 * account's `main_purse` URef balance. We accept whatever returns a
 * numeric balance and silently fall back when one shape is unsupported.
 */
export async function getBalanceMotes(publicKeyHex: string): Promise<string> {
  try {
    const v = await rpcCall<string>("state_get_balance", {
      purse_identifier: {
        main_purse_under_public_key: publicKeyHex,
      },
    });
    return v;
  } catch (err) {
    // Fallback: derive the main_purse URef from the account info and
    // query its balance directly. Most public Casper 2.0 testnet nodes
    // accept this combination.
    try {
      const accountInfo = await rpcCall<{
        account?: { main_purse?: string };
      }>("state_get_account_info", { public_key: publicKeyHex });
      const purseRef = accountInfo?.account?.main_purse;
      if (!purseRef) throw err;
      const v = await rpcCall<string>("state_get_balance", { purse_uref: purseRef });
      return v;
    } catch {
      throw err; // surface the original error from the first shape
    }
  }
}

interface GetDeployResult {
  api_version: string;
  deploy: {
    hash: string;
    header: { account: string; timestamp: string; ttl: string };
    payment: unknown;
    session: unknown;
  };
  execution_result: {
    block_hash?: string;
    block_height?: string | number;
    result: { Success?: unknown; Failure?: { error_message?: string } } | string;
  };
}

/**
 * Fetch a deploy or transaction by hash and wait until it has been
 * included in a block. Returns the block height as a string once
 * confirmed, or throws after `timeoutMs`.
 */
export async function waitForDeploy(
  hash: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ blockHeight: string; result: GetDeployResult }> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let lastErrorMessage: string | null = null;
  while (Date.now() < deadline) {
    try {
      // The Casper 2.0 RPC method is `info_get_transaction` for
      // TransactionV1 and `info_get_deploy` for legacy Deploys. Try V1 first.
      let res: GetDeployResult | null = null;
      try {
        res = await rpcCall<GetDeployResult>(
          "info_get_transaction",
          { transaction_hash: { Version1: hash } },
        );
      } catch {
        res = null;
      }
      if (!res) {
        try {
          res = await rpcCall<GetDeployResult>("info_get_deploy", hash);
        } catch {
          res = null;
        }
      }
      if (res?.execution_result) {
        const blockHeight = String(
          (res.execution_result as { block_height?: string | number }).block_height ?? "",
        );
        const successLike =
          (res.execution_result.result as { Success?: unknown }).Success;
        const failureLike =
          (res.execution_result.result as { Failure?: { error_message?: string } }).Failure;
        if (failureLike?.error_message) {
          lastErrorMessage = failureLike.error_message;
        }
        if (successLike !== undefined || blockHeight) {
          return { blockHeight, result: res };
        }
      }
    } catch (err) {
      // Network blip — keep polling.
      void err;
    }
    await sleep(intervalMs);
  }
  if (lastErrorMessage) {
    throw new CasperJsonRpcError(
      `transaction ${hash} failed on chain: ${lastErrorMessage}`,
      -32000,
    );
  }
  throw new CasperJsonRpcError(
    `transaction ${hash} not confirmed within ${Math.round(timeoutMs / 1000)}s`,
    -32001,
  );
}

/**
 * Submit a signed Casper TransactionV1 to the network through the proxy.
 *
 * The `txBytes` argument is the `bytes` field returned by
 * `Transaction.fromTransactionV1(v1).toBytes()` (or its hash variant).
 */
export async function putTransaction(
  txBytes: unknown,
): Promise<{ transactionHash: string }> {
  // The Casper 2.0 RPC for submitting a TransactionV1 is
  // `account_put_transaction` with a Deploy/Transaction wrapper.
  const result = await rpcCall<{ transaction_hash?: string } | string>(
    "account_put_transaction",
    { transaction: txBytes },
  );
  if (typeof result === "string") return { transactionHash: result };
  if (result && typeof result === "object" && "transaction_hash" in result) {
    return { transactionHash: (result as { transaction_hash?: string }).transaction_hash ?? "" };
  }
  throw new CasperJsonRpcError("account_put_transaction: missing transaction_hash", -32603);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
