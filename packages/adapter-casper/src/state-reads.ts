/**
 * Direct JSON-RPC state reads for the Node adapter.
 *
 * Replaces the historical `casper-client` CLI shell-outs: the CLI abbreviates
 * large byte strings in its JSON output (`[174 hex chars]`) unless `-vv` is
 * passed, and `-vv` in turn prepends the request envelope as a second JSON
 * document, so neither mode is machine-parseable. The JSON-RPC wire format
 * is the same protocol the browser adapter uses — one canonical read path,
 * no output parsing.
 *
 * Shapes verified against Casper 2.0 testnet (`node.testnet.casper.network`):
 *   - chain_get_state_root_hash:   params {}
 *   - query_global_state:          params { key, path }
 *   - state_get_dictionary_item:   params { state_root_hash,
 *                                    dictionary_identifier: { URef: {...} |
 *                                      ContractNamedKey: {...} } }
 */

export class CasperRpcError extends Error {
  public readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "CasperRpcError";
    this.code = code;
  }
}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/** Low-level JSON-RPC call against a Casper node. Throws on RPC errors. */
export async function rpcCall<T = unknown>(
  rpcUrl: string,
  method: string,
  params: unknown,
  authToken?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) headers.Authorization = authToken;
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new CasperRpcError(
      `HTTP ${res.status} ${res.statusText}`,
      res.status,
    );
  }
  const body = (await res.json()) as RpcResponse<T>;
  if (body.error) {
    throw new CasperRpcError(body.error.message, body.error.code);
  }
  if (body.result === undefined) {
    throw new CasperRpcError("missing result in response", -32603);
  }
  return body.result;
}

/** Fetch the latest state root hash. */
export async function getStateRootHash(
  rpcUrl: string,
  authToken?: string,
): Promise<string> {
  const r = await rpcCall<{ state_root_hash?: string }>(
    rpcUrl,
    "chain_get_state_root_hash",
    {},
    authToken,
  );
  if (!r?.state_root_hash)
    throw new CasperRpcError("no state root hash", -32603);
  return r.state_root_hash;
}

/** Query global state by key — returns the `stored_value` object. */
export async function queryGlobalState(
  rpcUrl: string,
  key: string,
  authToken?: string,
): Promise<Record<string, unknown>> {
  const r = await rpcCall<{ stored_value?: Record<string, unknown> }>(
    rpcUrl,
    "query_global_state",
    { key, path: [] },
    authToken,
  );
  if (!r?.stored_value) throw new CasperRpcError("no stored_value", -32603);
  return r.stored_value;
}

export interface CLValueResult {
  bytes?: string;
  parsed?: unknown;
  cl_type?: unknown;
}

/** Read a dictionary item by seed URef + blake2b item key. Null when absent. */
export async function getDictionaryItemByURef(
  rpcUrl: string,
  stateRoot: string,
  seedUref: string,
  itemKeyHex: string,
  authToken?: string,
): Promise<CLValueResult | null> {
  try {
    const r = await rpcCall<{ stored_value?: { CLValue?: CLValueResult } }>(
      rpcUrl,
      "state_get_dictionary_item",
      {
        state_root_hash: stateRoot,
        dictionary_identifier: {
          URef: { seed_uref: seedUref, dictionary_item_key: itemKeyHex },
        },
      },
      authToken,
    );
    return r?.stored_value?.CLValue ?? null;
  } catch (err) {
    // The node errors when the item key is absent — that is the steady
    // state for "no credential here", not a failure.
    if (err instanceof CasperRpcError) return null;
    throw err;
  }
}

/** Read a dictionary item by contract named key (e.g. AgentId.wallet_of_agent). */
export async function getDictionaryItemByContractNamedKey(
  rpcUrl: string,
  stateRoot: string,
  contractHash: string,
  dictionaryName: string,
  itemKeyHex: string,
  authToken?: string,
): Promise<CLValueResult | null> {
  try {
    const r = await rpcCall<{ stored_value?: { CLValue?: CLValueResult } }>(
      rpcUrl,
      "state_get_dictionary_item",
      {
        state_root_hash: stateRoot,
        dictionary_identifier: {
          ContractNamedKey: {
            key: contractHash,
            dictionary_name: dictionaryName,
            dictionary_item_key: itemKeyHex,
          },
        },
      },
      authToken,
    );
    return r?.stored_value?.CLValue ?? null;
  } catch (err) {
    if (err instanceof CasperRpcError) return null;
    throw err;
  }
}

/**
 * Resolve a contract package hash to its latest contract hash and the
 * contract's `state` named-key URef — the two facts every Odra registry
 * read needs. Shared by verifyCapability, credentialStanding and the
 * issuer-nonce read in signCredential.
 */
export async function resolveContractState(
  rpcUrl: string,
  packageHashHex: string,
  authToken?: string,
): Promise<{ contractHash: string; stateUref: string }> {
  const pkgKey = `hash-${packageHashHex.replace(/^(contract-package-|hash-|0x)/, "")}`;
  const pkgValue = await queryGlobalState(rpcUrl, pkgKey, authToken);
  const pkg = pkgValue?.ContractPackage as
    { versions?: Array<{ contract_hash?: string }> } | undefined;
  const versions = pkg?.versions ?? [];
  const contractHashRaw = versions[versions.length - 1]?.contract_hash ?? "";
  if (!contractHashRaw) {
    throw new CasperRpcError("no contract hash in package", -32603);
  }
  const contractHash = `hash-${contractHashRaw.replace(/^contract-/, "")}`;

  const contractValue = await queryGlobalState(rpcUrl, contractHash, authToken);
  const contract = contractValue?.Contract as
    { named_keys?: Array<{ name: string; key: string }> } | undefined;
  if (!contract) throw new CasperRpcError("contract not found", -32603);
  const stateUref = contract.named_keys?.find((k) => k.name === "state")?.key;
  if (!stateUref) throw new CasperRpcError("state URef not found", -32603);
  return { contractHash, stateUref };
}
