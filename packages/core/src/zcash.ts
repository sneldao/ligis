/**
 * ZcashChainAdapter — additive shielded payment & credential presentation
 * adapter behind the @ligis/core ChainAdapter boundary.
 *
 * Spec: `docs/zecathon-entry.md` & `docs/zcash-shielded-credentials.md`.
 *
 * Zcash has no EVM and no on-chain smart contracts; its Sapling and Orchard
 * pools provide shielded notes, incoming viewing keys (selective disclosure),
 * 512-byte encrypted memos, and context-bound nullifiers.
 *
 * Week 1 supports:
 *   1. Viewing-key selective disclosure (via registered disclosures or
 *      Zebra/zcashd `z_listreceivedbyaddress` / `z_viewtransaction` RPC memo
 *      inspection)
 *   2. Nullifier replay protection (a spent nullifier reports `revoked: true`
 *      and `capable: false` so replay attempts always STOP)
 *   3. Week 2 ZK proof envelope hook (`ZcashZkPresentation`)
 */
import type {
  AnchorEvidenceOpts,
  CapabilityRef,
  ChainAdapter,
  IssueAgentIdOpts,
  IssueAgentIdResult,
  RevokeOpts,
  SignCredentialOpts,
  VerifyResult,
} from "./adapter.js";
import { formatDid } from "./did.js";
import type { LiveAttestation, ZcashLightClient } from "./zcash-lwd.js";
import { capabilityHash, isHexBytes32, parseCapability } from "./hash.js";
import type {
  Bytes32,
  CapabilityHash,
  CredentialView,
  SignedCredential,
  TxRef,
} from "./types.js";

// ─── Address & viewing-key format validation ────────────────────────────

/**
 * Zcash shielded address prefixes (Bech32 / Bech32m):
 *   - Unified addresses: `u1` (mainnet), `utest1` (testnet)
 *   - Sapling shielded addresses: `zs1` (mainnet), `ztestsapling1` (testnet)
 * Character set after separator `1`: lower-case alphanumeric excluding `1`, `b`, `i`, `o`.
 */
const ZCASH_SHIELDED_ADDR_RE =
  /^(?:u1|utest1|zs1|ztestsapling1)[ac-hj-np-z02-9]{38,220}$/;

/**
 * Zcash incoming viewing keys (Bech32 / Bech32m):
 *   - Unified IVK: `uivk1` (mainnet), `uivktest1` (testnet)
 *   - Sapling extended IVK: `zxviews1` (mainnet), `zxviewtestsapling1` (testnet)
 */
const ZCASH_VIEWING_KEY_RE =
  /^(?:uivk1|uivktest1|zxviews1|zxviewtestsapling1)[ac-hj-np-z02-9]{32,320}$/;

/** True when `raw` is a syntactically valid Zcash Unified or Sapling shielded address. */
export function isZcashShieldedAddress(raw: string): boolean {
  const trimmed = raw.trim();
  return ZCASH_SHIELDED_ADDR_RE.test(trimmed);
}

/** True when `raw` is a syntactically valid Zcash Unified or Sapling incoming viewing key. */
export function isZcashViewingKey(raw: string): boolean {
  const trimmed = raw.trim();
  return ZCASH_VIEWING_KEY_RE.test(trimmed);
}

// ─── Presentation & RPC types ───────────────────────────────────────────

/**
 * Week 1: Selective disclosure via a Zcash incoming viewing key or decrypted
 * 512-byte shielded memo.
 */
export interface ZcashViewingKeyDisclosure {
  mode: "viewing-key";
  /** Shielded Zcash payee address (`u1…`, `utest1…`, `zs1…`, `ztestsapling1…`). */
  subject: string;
  /** Optional incoming viewing key disclosed by the payee to the gate. */
  viewingKey?: string;
  /** Capability name or 0x-prefixed 32-byte keccak256 hash. */
  capability: CapabilityRef;
  /** Ligis / EVM issuer address that attested to the capability. */
  issuer: string;
  /** Unix timestamp (seconds) as decimal string. */
  issuedAt: string;
  /** Unix timestamp (seconds) as decimal string; "0" = no expiry. */
  expiresAt: string;
  /** Context-bound 32-byte nullifier; spending it prevents replay. */
  nullifier: Bytes32;
  /** Optional shielded transfer amount in zatoshis (1 ZEC = 10^8 zatoshis). */
  amountZatoshis?: string;
  /** Optional Zcash shielded transaction ID. */
  txid?: string;
}

/**
 * Week 2: Zero-knowledge credential presentation proving possession of a valid
 * Ligis credential leaf in `registryRoot` without revealing issuer or subject.
 */
export interface ZcashZkPresentation {
  mode: "zk-proof";
  /** Shielded Zcash payee address or ephemeral presentation handle. */
  subject: string;
  provingSystem: "groth16-sapling" | "halo2-orchard";
  /** Hex-encoded proof bytes. */
  proof: `0x${string}`;
  publicInputs: {
    capabilityHash: CapabilityHash;
    registryRoot: Bytes32;
    nullifier: Bytes32;
  };
  /** Unix timestamp (seconds) as decimal string; defaults to 0 (bound by root). */
  issuedAt?: string;
  /** Unix timestamp (seconds) as decimal string; defaults to 0 (bound by root). */
  expiresAt?: string;
}

export type ZcashPresentation = ZcashViewingKeyDisclosure | ZcashZkPresentation;

/** Sentinel issuer address used when a ZK proof verifies against a public registry root without revealing which issuer signed the leaf. */
export const ZCASH_ZK_ROOT_VERIFIER_ISSUER =
  "0x00000000000000000000000000000000000007c0";

/** Structure returned by `z_listreceivedbyaddress` on zcashd / Zebra lightwalletd. */
export interface ZcashReceivedNote {
  txid: string;
  amount: number;
  amountZat?: number;
  memo: string; // 512-byte hex string
  confirmations: number;
  outindex?: number;
}

/** Injectable JSON-RPC transport for Zebra / zcashd nodes. */
export interface ZcashRpcTransport {
  call<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}

/** Create a standard HTTP JSON-RPC transport for Zebra / zcashd. */
export function createHttpZcashRpcTransport(opts: {
  rpcUrl: string;
  rpcUser?: string;
  rpcPassword?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ZcashRpcTransport {
  const fetchFn = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 4_000;
  return {
    async call<T = unknown>(
      method: string,
      params: unknown[] = [],
    ): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (opts.rpcUser || opts.rpcPassword) {
          const token = Buffer.from(
            `${opts.rpcUser ?? ""}:${opts.rpcPassword ?? ""}`,
          ).toString("base64");
          headers.authorization = `Basic ${token}`;
        }
        const res = await fetchFn(opts.rpcUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "ligis-zcash",
            method,
            params,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Zcash RPC HTTP ${res.status}: ${res.statusText}`);
        }
        const data = (await res.json()) as {
          result?: T;
          error?: { code?: number; message?: string } | null;
        };
        if (data.error) {
          throw new Error(
            `Zcash RPC error ${data.error.code ?? ""}: ${data.error.message ?? "unknown"}`,
          );
        }
        return data.result as T;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ─── 512-byte shielded memo parser ──────────────────────────────────────

const MEMO_PREFIX = "LIGIS:v1:";

export interface ParsedZcashMemoAttestation {
  capability: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  nullifier: Bytes32;
}

/**
 * Encode a Ligis selective-disclosure attestation into a 512-byte Zcash hex memo.
 */
export function encodeZcashMemoAttestation(
  attestation: ParsedZcashMemoAttestation,
): string {
  const payload = `${MEMO_PREFIX}${JSON.stringify(attestation)}`;
  const bytes = new TextEncoder().encode(payload);
  if (bytes.length > 512) {
    throw new Error(`Zcash memo payload exceeds 512 bytes (${bytes.length})`);
  }
  const padded = new Uint8Array(512);
  padded.set(bytes, 0);
  let hex = "";
  for (const b of padded) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Decode a 512-byte hex Zcash memo field (or plain UTF-8 string) into a
 * Ligis selective-disclosure attestation, or return null if not a Ligis memo.
 */
export function parseZcashMemoAttestation(
  memoHexOrText: string,
): ParsedZcashMemoAttestation | null {
  const raw = memoHexOrText.trim().replace(/^0x/i, "");
  if (!raw) return null;

  let text: string;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    // Strip trailing 0x00 or 0xf6 (Zcash empty-memo padding byte)
    const bytes: number[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const byte = parseInt(raw.slice(i, i + 2), 16);
      if (byte === 0x00 || byte === 0xf6) break;
      bytes.push(byte);
    }
    text = new TextDecoder().decode(new Uint8Array(bytes));
  } else {
    text = memoHexOrText.trim();
  }

  if (!text.startsWith(MEMO_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(MEMO_PREFIX.length)) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed.capability !== "string" ||
      typeof parsed.issuer !== "string" ||
      typeof parsed.issuedAt !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.nullifier !== "string" ||
      !isHexBytes32(parsed.nullifier)
    ) {
      return null;
    }
    return {
      capability: parsed.capability,
      issuer: parsed.issuer,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
      nullifier: parsed.nullifier,
    };
  } catch {
    return null;
  }
}

// ─── Nullifier replay store ─────────────────────────────────────────────

export interface ZcashNullifierStore {
  isSpent(nullifier: Bytes32): boolean;
  markSpent(nullifier: Bytes32): void;
}

export class InMemoryZcashNullifierStore implements ZcashNullifierStore {
  private readonly spent = new Set<string>();

  constructor(initialSpent: readonly Bytes32[] = []) {
    for (const n of initialSpent) {
      this.spent.add(n.toLowerCase());
    }
  }

  isSpent(nullifier: Bytes32): boolean {
    return this.spent.has(nullifier.toLowerCase());
  }

  markSpent(nullifier: Bytes32): void {
    this.spent.add(nullifier.toLowerCase());
  }
}

// ─── Deterministic Zecathon Testnet Demo Fixtures ───────────────────────

/** Verified shielded Zcash agent holding `agent.commerce.escrow` and `kyc.basic` via viewing-key disclosure. */
export const ZCASH_DEMO_VERIFIED_SUBJECT =
  "utest1e35c2ayfrjk6zjzrqsl8nsrpnqfcxl6t0njmu4gmxw78379mqwth3szguwwteltya2my8t9795stpdpsxccxl00xhzea9wmtzx4rwj9ddavysydxpk300a67vsutjfqwjm36w4a4gama7kldyvu3r9929pcxkt5r3etrwfjpfvqryfgr";

/** Unified Incoming Viewing Key for `ZCASH_DEMO_VERIFIED_SUBJECT` (decrypts `ZCASH_DEMO_CONFIRMED_TXID`). */
export const ZCASH_DEMO_VERIFIED_UIVK =
  "uivktest1eedd60g75nttawzcu0gqwkgqh7069qkeddf78kn5ymqaufls27jdrpklqrxtkvpn3d65quzr2e7h726ca0xjtzcmple2l4d58k2xv5y8j55a77tqdelca3h29vxext5ek7q9uc3u2yyr3snwa0lpegr0yjdpwtxt395td8r9wq3nupsdufynzh7c7c3jp757rlyyepg8rp9mkc684fjpextgr52zm5hmd5ap6d8v8a2uwyu4puk";

/** Real shielded Zcash Testnet transaction carrying the encrypted `LIGIS:v1:` memo (confirmed at block 4,540,356). */
export const ZCASH_DEMO_CONFIRMED_TXID =
  "d2b389c8fd108561f3cdc45cfcb373e7474dbb8804368fcd560135f9cb443f90";

/** Shielded Zcash presentation whose nullifier has already been spent (replay attack → STOP). */
export const ZCASH_DEMO_REPLAYED_SUBJECT =
  "utest1r0jlaacmqk25tgzzww76q9wmypek2dtsvpkvl9kg2l3uzje689vc4zcumtrr6udkj23nvw8zd8rwc8zacnujem3wtv6q4xdm9ffjpr7ecs5mnvsz7wrluwh7fcn525jch4mhhrqcespfsj2u0dqzftjzxvmjhnr85rrptczduv4wafxh";

/** Unverified Zcash shielded wallet with no disclosure or proof (→ STOP). */
export const ZCASH_DEMO_UNVERIFIED_SUBJECT =
  "utest1r0huypn2lfel0p4g70sfekgjepwnlr8amklf7qld5uzk8nxmaq3nqpf3ljxl8hym4zy7nm0p6cruadrdrqxsf6avpgkl4axam0zhm4l36ytqyseduag4lzww7r44y9hv9am6uvztl7542cxjnnh0fw300r0jmx2m2fsr9wa69qnmekje";

export const ZCASH_DEMO_SPENT_NULLIFIER: Bytes32 =
  "0x9999999999999999999999999999999999999999999999999999999999999999";

export const ZCASH_DEMO_VALID_NULLIFIER_ESCROW: Bytes32 =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

export const ZCASH_DEMO_VALID_NULLIFIER_KYC: Bytes32 =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

export const ZCASH_DEMO_STEWARD_ISSUER =
  "0x9E6eC93200E185c11423eb3A5150449D49d3473A";

const DEFAULT_DEMO_DISCLOSURES: readonly ZcashViewingKeyDisclosure[] = [
  {
    mode: "viewing-key",
    subject: ZCASH_DEMO_VERIFIED_SUBJECT,
    viewingKey: ZCASH_DEMO_VERIFIED_UIVK,
    capability: "agent.commerce.escrow",
    issuer: ZCASH_DEMO_STEWARD_ISSUER,
    issuedAt: "1761350400", // 2025-10-25T00:00:00Z
    expiresAt: "1824422400", // 2027-10-25T00:00:00Z
    nullifier: ZCASH_DEMO_VALID_NULLIFIER_ESCROW,
    amountZatoshis: "100000000", // 1.0 TAZ (confirmed at block 4,540,356)
    txid: ZCASH_DEMO_CONFIRMED_TXID,
  },
  {
    mode: "viewing-key",
    subject: ZCASH_DEMO_VERIFIED_SUBJECT,
    viewingKey: ZCASH_DEMO_VERIFIED_UIVK,
    capability: "kyc.basic",
    issuer: ZCASH_DEMO_STEWARD_ISSUER,
    issuedAt: "1761350400",
    expiresAt: "1824422400",
    nullifier: ZCASH_DEMO_VALID_NULLIFIER_KYC,
    amountZatoshis: "100000000",
    txid: ZCASH_DEMO_CONFIRMED_TXID,
  },
  {
    mode: "viewing-key",
    subject: ZCASH_DEMO_REPLAYED_SUBJECT,
    viewingKey:
      "uivktest1nrnn7y54s9qn3y5m7mg6x9ymu2xwwsj3yxcja8ew0jxz5frwqhvhkrm07af76prstkmxa09zt5gx4d5udgkn80cl543jfluq7ekw32mmvxs9vwqj3029vzcnmczgd9unf08ufsk2vl7yhwwmwrmwguzgks6vj88evmznrx440tptfcjp5pe4x7sqfg6aqhaqfk0f4mc2nfk0fl8u9wdvdqnf4m84nlrdxw84y4d9rnw7ykkx4n8",
    capability: "agent.commerce.escrow",
    issuer: ZCASH_DEMO_STEWARD_ISSUER,
    issuedAt: "1761350400",
    expiresAt: "1824422400",
    nullifier: ZCASH_DEMO_SPENT_NULLIFIER,
    amountZatoshis: "25000000",
    txid: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  },
  {
    mode: "viewing-key",
    subject: ZCASH_DEMO_REPLAYED_SUBJECT,
    viewingKey:
      "uivktest1nrnn7y54s9qn3y5m7mg6x9ymu2xwwsj3yxcja8ew0jxz5frwqhvhkrm07af76prstkmxa09zt5gx4d5udgkn80cl543jfluq7ekw32mmvxs9vwqj3029vzcnmczgd9unf08ufsk2vl7yhwwmwrmwguzgks6vj88evmznrx440tptfcjp5pe4x7sqfg6aqhaqfk0f4mc2nfk0fl8u9wdvdqnf4m84nlrdxw84y4d9rnw7ykkx4n8",
    capability: "kyc.basic",
    issuer: ZCASH_DEMO_STEWARD_ISSUER,
    issuedAt: "1761350400",
    expiresAt: "1824422400",
    nullifier: ZCASH_DEMO_SPENT_NULLIFIER,
    amountZatoshis: "25000000",
    txid: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  },
];

// ─── ZcashChainAdapter ──────────────────────────────────────────────────

export interface ZcashChainAdapterOptions {
  network?: "zcash-testnet" | "zcash-mainnet";
  rpcUrl?: string;
  rpcTransport?: ZcashRpcTransport;
  /** Light client for live reads (default: lightwalletd at `LIGIS_ZCASH_LWD_URL` when set). */
  lightClient?: ZcashLightClient;
  nullifierStore?: ZcashNullifierStore;
  /** Pluggable Week 2 ZK proof verifier; defaults to structural + non-empty proof check. */
  verifyZkProof?: (presentation: ZcashZkPresentation) => Promise<boolean>;
  /** Include the deterministic Zecathon testnet fixtures (default: true on testnet). */
  includeDemoFixtures?: boolean;
  /** Current time override (unix seconds) for deterministic tests. */
  nowSeconds?: () => number;
}

export class ZcashChainAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly chainName: string;
  readonly explorerUrl: string;

  private readonly rpc?: ZcashRpcTransport;
  private readonly lwd?: ZcashLightClient;
  private readonly nullifiers: ZcashNullifierStore;
  private readonly presentations = new Map<string, ZcashPresentation>();
  private readonly verifyZk?: (
    presentation: ZcashZkPresentation,
  ) => Promise<boolean>;
  private readonly nowSeconds: () => number;

  constructor(opts: ZcashChainAdapterOptions = {}) {
    const net = opts.network ?? "zcash-testnet";
    this.chainId = net;
    this.chainName =
      net === "zcash-mainnet" ? "Zcash Mainnet" : "Zcash Testnet";
    this.explorerUrl =
      net === "zcash-mainnet"
        ? "https://mainnet.zcashexplorer.app"
        : "https://testnet.zcashexplorer.app";

    const rpcUrl = opts.rpcUrl ?? process.env.LIGIS_ZCASH_RPC_URL;
    this.rpc =
      opts.rpcTransport ??
      (rpcUrl
        ? createHttpZcashRpcTransport({
            rpcUrl,
            rpcUser: process.env.LIGIS_ZCASH_RPC_USER,
            rpcPassword: process.env.LIGIS_ZCASH_RPC_PASSWORD,
          })
        : undefined);

    this.lwd = opts.lightClient;

    this.nullifiers =
      opts.nullifierStore ??
      new InMemoryZcashNullifierStore([ZCASH_DEMO_SPENT_NULLIFIER]);
    this.verifyZk = opts.verifyZkProof;
    this.nowSeconds = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

    const includeFixtures = opts.includeDemoFixtures ?? net === "zcash-testnet";
    if (includeFixtures) {
      for (const d of DEFAULT_DEMO_DISCLOSURES) {
        this.registerPresentation(d);
      }
    }
  }

  private presentationKey(subject: string, capHash: CapabilityHash): string {
    return `${subject.trim().toLowerCase()}:${capHash.toLowerCase()}`;
  }

  /**
   * Register a viewing-key selective disclosure or ZK presentation for a
   * shielded subject and capability.
   */
  registerPresentation(presentation: ZcashPresentation): void {
    const capHash =
      presentation.mode === "viewing-key"
        ? parseCapability(presentation.capability)
        : presentation.publicInputs.capabilityHash;
    this.presentations.set(
      this.presentationKey(presentation.subject, capHash),
      presentation,
    );
  }

  /** Latest block height from the configured light client, or null. */
  async latestHeight(): Promise<number | null> {
    return this.lwd ? this.lwd.getLatestHeight() : null;
  }

  /**
   * Fetch and decrypt a Zcash note with a disclosed viewing key.
   * Returns an untrusted memo claim without registering a credential.
   * Issuer authentication must be performed separately before authorization.
   * The light server supplies inclusion height; this is not an SPV proof.
   */
  async readLiveAttestation(opts: {
    subject: string;
    viewingKey: string;
    txid: string;
  }): Promise<LiveAttestation & { presentation: ZcashViewingKeyDisclosure }> {
    if (!this.lwd) {
      throw new Error(
        "no Zcash light client configured (set LIGIS_ZCASH_LWD_URL or pass lightClient)",
      );
    }
    if (!isZcashViewingKey(opts.viewingKey)) {
      throw new Error("invalid Zcash unified incoming viewing key");
    }
    const { readNotesForAddress } = await import("./zcash-lwd.js");
    const notes = await readNotesForAddress({
      client: this.lwd,
      txid: opts.txid,
      ua: opts.subject.trim(),
      uivk: opts.viewingKey.trim(),
    });
    for (const n of notes) {
      const memo = parseZcashMemoAttestation(n.memo);
      if (!memo) continue;
      const presentation: ZcashViewingKeyDisclosure = {
        mode: "viewing-key",
        subject: opts.subject.trim(),
        viewingKey: opts.viewingKey.trim(),
        capability: memo.capability,
        issuer: memo.issuer,
        issuedAt: memo.issuedAt,
        expiresAt: memo.expiresAt,
        nullifier: memo.nullifier,
        amountZatoshis: n.valueZat.toString(),
        txid: n.txid,
      };
      // Memo fields are sender-controlled claims, not issuer authentication.
      // Reading a note must never grant a capability.
      return { ...n, presentation };
    }
    throw new Error("no note addressed to subject carries a LIGIS:v1 memo");
  }

  /**
   * Mark a nullifier as spent (e.g. after a shielded payment is authorized).
   * Subsequent verification attempts with the same nullifier will return
   * `revoked: true, capable: false`.
   */
  spendNullifier(nullifier: Bytes32): void {
    this.nullifiers.markSpent(nullifier);
  }

  /** Check whether a nullifier has already been consumed. */
  isNullifierSpent(nullifier: Bytes32): boolean {
    return this.nullifiers.isSpent(nullifier);
  }

  // ---------- identity ----------

  async getAgentId(controller: string): Promise<string | null> {
    if (!isZcashShieldedAddress(controller)) return null;
    return controller.trim();
  }

  async issueAgentId(opts: IssueAgentIdOpts = {}): Promise<IssueAgentIdResult> {
    const controller = opts.controller?.trim() ?? "";
    if (!isZcashShieldedAddress(controller)) {
      throw new Error(
        "ZcashChainAdapter.issueAgentId requires a valid Zcash shielded address (u1/utest1/zs1/ztestsapling1)",
      );
    }
    return {
      agentId: controller,
      did: formatDid(this.chainId, controller),
      controller,
      tx: {
        hash: `zcash-shielded-id:${controller.slice(0, 16)}`,
        explorerUrl: this.explorerUrl,
      },
    };
  }

  async rotateAgentId(): Promise<{ tx: TxRef }> {
    throw new Error(
      "Zcash shielded addresses rotate via diversified Unified Addresses off-chain, not on-chain state transitions.",
    );
  }

  // ---------- credentials ----------

  async verifyCapability(opts: {
    subject: string;
    capability: CapabilityRef;
    issuer?: string;
  }): Promise<VerifyResult> {
    const subject = opts.subject.trim();
    if (!isZcashShieldedAddress(subject)) {
      throw new Error(
        `Invalid Zcash shielded address: expected u1…, utest1…, zs1…, or ztestsapling1…`,
      );
    }
    const capHash = parseCapability(opts.capability);
    const key = this.presentationKey(subject, capHash);

    let presentation = this.presentations.get(key);

    // If not in local presentation cache and an RPC transport is configured,
    // query `z_listreceivedbyaddress` for shielded memo attestations.
    if (!presentation && this.rpc) {
      const notes = await this.rpc.call<ZcashReceivedNote[]>(
        "z_listreceivedbyaddress",
        [subject, 1],
      );
      if (Array.isArray(notes)) {
        for (const note of notes) {
          const decoded = parseZcashMemoAttestation(note.memo);
          if (
            decoded &&
            parseCapability(decoded.capability).toLowerCase() ===
              capHash.toLowerCase()
          ) {
            presentation = {
              mode: "viewing-key",
              subject,
              capability: decoded.capability,
              issuer: decoded.issuer,
              issuedAt: decoded.issuedAt,
              expiresAt: decoded.expiresAt,
              nullifier: decoded.nullifier,
              amountZatoshis:
                note.amountZat !== undefined
                  ? String(note.amountZat)
                  : String(Math.round(note.amount * 1e8)),
              txid: note.txid,
            };
            this.presentations.set(key, presentation);
            break;
          }
        }
      }
    }

    if (!presentation) {
      return {
        capable: false,
        capabilityHash: capHash,
        subject,
        capability: String(opts.capability),
        latest: {
          issuer: "0x0000000000000000000000000000000000000000",
          issuedAt: "0",
          expiresAt: "0",
          revoked: false,
          valid: false,
        },
      };
    }

    const now = this.nowSeconds();

    if (presentation.mode === "viewing-key") {
      const spent = this.nullifiers.isSpent(presentation.nullifier);
      const exp = Number(presentation.expiresAt);
      const expired = exp > 0 && exp <= now;
      const selfIssued =
        presentation.issuer.trim().toLowerCase() === subject.toLowerCase();
      const issuerMismatch =
        opts.issuer !== undefined &&
        opts.issuer.trim().toLowerCase() !==
          presentation.issuer.trim().toLowerCase();

      const valid = !spent && !expired && !selfIssued && !issuerMismatch;
      const latest: CredentialView = {
        issuer: presentation.issuer,
        issuedAt: presentation.issuedAt,
        expiresAt: presentation.expiresAt,
        // A spent nullifier is surfaced as `revoked: true` so the gate reports
        // a hard STOP (replay rejected) rather than "missing credential".
        revoked: spent,
        valid,
      };
      return {
        capable: valid,
        capabilityHash: capHash,
        subject,
        capability: String(opts.capability),
        latest,
      };
    }

    // Week 2 ZK proof mode
    const spent = this.nullifiers.isSpent(presentation.publicInputs.nullifier);
    const exp = Number(presentation.expiresAt ?? "0");
    const expired = exp > 0 && exp <= now;
    const proofOk = this.verifyZk
      ? await this.verifyZk(presentation)
      : presentation.proof.startsWith("0x") && presentation.proof.length >= 66;
    const valid = !spent && !expired && proofOk;

    return {
      capable: valid,
      capabilityHash: capHash,
      subject,
      capability: String(opts.capability),
      latest: {
        issuer: ZCASH_ZK_ROOT_VERIFIER_ISSUER,
        issuedAt: presentation.issuedAt ?? "0",
        expiresAt: presentation.expiresAt ?? "0",
        revoked: spent,
        valid,
      },
    };
  }

  async signCredential(opts: SignCredentialOpts): Promise<SignedCredential> {
    const capHash = parseCapability(opts.capability);
    const now = this.nowSeconds();
    const expiresAt = now + (opts.expiresInSeconds ?? 30 * 86_400);
    const nullifier = capabilityHash(
      `zcash-nullifier:${opts.subject}:${capHash}:${now}`,
    );
    const memoHex = encodeZcashMemoAttestation({
      capability: String(opts.capability),
      issuer: opts.issuerKey,
      issuedAt: String(now),
      expiresAt: String(expiresAt),
      nullifier,
    });
    return {
      issuer: opts.issuerKey,
      subject: opts.subject,
      capabilityHash: capHash,
      issuedAt: String(now),
      expiresAt: String(expiresAt),
      nonce: "1",
      digest: nullifier,
      signature: `0x${memoHex}`,
      submitCommand: `zcash-cli z_sendmany "$FROM_ZADDR" '[{"address":"${opts.subject}","amount":0.0001,"memo":"${memoHex}"}]'`,
    };
  }

  async submitCredential(signed: SignedCredential): Promise<{ tx: TxRef }> {
    this.registerPresentation({
      mode: "viewing-key",
      subject: signed.subject,
      capability: signed.capabilityHash,
      issuer: signed.issuer,
      issuedAt: signed.issuedAt,
      expiresAt: signed.expiresAt,
      nullifier: signed.digest,
    });
    return {
      tx: {
        hash: signed.digest,
        explorerUrl: this.explorerUrl,
      },
    };
  }

  async revokeCredential(opts: RevokeOpts): Promise<{ tx: TxRef }> {
    const capHash = parseCapability(opts.capability);
    const existing = this.presentations.get(
      this.presentationKey(opts.subject, capHash),
    );
    const nullifier =
      existing?.mode === "viewing-key"
        ? existing.nullifier
        : existing?.mode === "zk-proof"
          ? existing.publicInputs.nullifier
          : (opts.nonce as Bytes32);
    if (isHexBytes32(nullifier)) {
      this.spendNullifier(nullifier);
    }
    return {
      tx: {
        hash: isHexBytes32(nullifier)
          ? nullifier
          : capabilityHash(`revoke:${opts.subject}:${capHash}`),
        explorerUrl: this.explorerUrl,
      },
    };
  }

  async anchorEvidence(opts: AnchorEvidenceOpts): Promise<{ tx: TxRef }> {
    const hash = capabilityHash(`zcash-evidence:${opts.agentId}:${opts.uri}`);
    return {
      tx: {
        hash,
        explorerUrl: this.explorerUrl,
      },
    };
  }

  hasWallet(): boolean {
    return Boolean(process.env.LIGIS_ZCASH_VIEWING_KEY);
  }

  walletAddress(): string | null {
    return process.env.LIGIS_ZCASH_SHIELDED_ADDRESS ?? null;
  }
}
