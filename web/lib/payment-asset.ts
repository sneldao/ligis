/**
 * Typed payment assets for the Ligis gate.
 *
 * A `PaymentIntent` names the exact token, chain, and on-chain amount it is
 * about to move. Amounts are integer base units encoded as decimal strings so
 * they survive JSON and never touch float math:
 *
 *   - ZEC  → zatoshis   (8 decimals, 1 ZEC  = 100_000_000 zat)
 *   - USDC → micro-USDC (6 decimals, 1 USDC = 1_000_000)
 *
 * Chain ids are CAIP-2 strings (`zcash:testnet`, `eip155:10143`). The rail is
 * derived from the token — it is never a free-standing field that could
 * disagree with the token/chain pair.
 *
 * Client-safe: no server-only imports.
 */
import { MONAD_TESTNET, PHAROS_ATLANTIC, ZCASH_TESTNET } from "./network";

// ─── token + rail registry ─────────────────────────────────────────────

export type PaymentRail = "zcash-shielded" | "evm-erc20";

export const TOKENS = {
  ZEC: {
    symbol: "ZEC",
    decimals: 8,
    baseUnit: "zatoshi",
    rail: "zcash-shielded",
    chainNamespace: "zcash",
  },
  USDC: {
    symbol: "USDC",
    decimals: 6,
    baseUnit: "micro-USDC",
    rail: "evm-erc20",
    chainNamespace: "eip155",
  },
} as const satisfies Record<
  string,
  {
    symbol: string;
    decimals: number;
    baseUnit: string;
    rail: PaymentRail;
    chainNamespace: "zcash" | "eip155";
  }
>;

export type TokenSymbol = keyof typeof TOKENS;
export type TokenDecimals<S extends TokenSymbol = TokenSymbol> =
  (typeof TOKENS)[S]["decimals"];

export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[];

/** CAIP-2 chain ids per rail. */
export type ZcashChainId = "zcash:testnet" | "zcash:mainnet";
export type EvmChainId = `eip155:${number}`;
export type PaymentChainId = ZcashChainId | EvmChainId;

/** Non-negative integer amount in the token's smallest unit, as a string. */
export type BaseUnits = `${bigint}`;

export type ZecPaymentAmount = {
  tokenSymbol: "ZEC";
  chainId: ZcashChainId;
  /** Zatoshis (1e-8 ZEC). */
  amountBaseUnits: BaseUnits;
};

export type UsdcPaymentAmount = {
  tokenSymbol: "USDC";
  chainId: EvmChainId;
  /** micro-USDC (1e-6 USDC). */
  amountBaseUnits: BaseUnits;
};

/** Discriminated on `tokenSymbol`: ZEC can only ride a Zcash chain id,
 *  USDC can only ride an EVM chain id. */
export type PaymentAmount = ZecPaymentAmount | UsdcPaymentAmount;

export const ZCASH_TESTNET_CHAIN_ID: ZcashChainId = "zcash:testnet";
export const MONAD_TESTNET_CHAIN_ID: EvmChainId = `eip155:${MONAD_TESTNET.chainId ?? 10143}`;
export const PHAROS_ATLANTIC_CHAIN_ID: EvmChainId = `eip155:${PHAROS_ATLANTIC.chainId ?? 688689}`;

/** Default chain per token when a caller omits `chainId`. */
export const DEFAULT_CHAIN_ID = {
  ZEC: ZCASH_TESTNET_CHAIN_ID,
  USDC: MONAD_TESTNET_CHAIN_ID,
} as const satisfies { ZEC: ZcashChainId; USDC: EvmChainId };

/** Upper bound on base-unit digits (≈ uint128). Keeps parsing bounded. */
const MAX_BASE_UNIT_DIGITS = 39;

// ─── helpers ───────────────────────────────────────────────────────────

export function isTokenSymbol(v: unknown): v is TokenSymbol {
  return typeof v === "string" && Object.hasOwn(TOKENS, v);
}

export function tokenDecimals<S extends TokenSymbol>(
  symbol: S,
): TokenDecimals<S> {
  return TOKENS[symbol].decimals;
}

export function railFor(
  amount: Pick<PaymentAmount, "tokenSymbol">,
): PaymentRail {
  return TOKENS[amount.tokenSymbol].rail;
}

export function isBaseUnits(v: unknown): v is BaseUnits {
  return (
    typeof v === "string" &&
    v.length <= MAX_BASE_UNIT_DIGITS &&
    /^(0|[1-9][0-9]*)$/.test(v)
  );
}

export function isZcashChainId(v: unknown): v is ZcashChainId {
  return v === "zcash:testnet" || v === "zcash:mainnet";
}

export function isEvmChainId(v: unknown): v is EvmChainId {
  return typeof v === "string" && /^eip155:[1-9][0-9]{0,15}$/.test(v);
}

/** True when `chainId` is a valid chain for `symbol`'s rail. */
export function chainMatchesToken(
  symbol: TokenSymbol,
  chainId: unknown,
): chainId is PaymentChainId {
  return symbol === "ZEC" ? isZcashChainId(chainId) : isEvmChainId(chainId);
}

/** Map a CAIP-2 chain id to the web app's network slug, when known. */
export function networkIdForChain(chainId: PaymentChainId): string | undefined {
  if (chainId === ZCASH_TESTNET_CHAIN_ID) return ZCASH_TESTNET.id;
  if (chainId === MONAD_TESTNET_CHAIN_ID) return MONAD_TESTNET.id;
  if (chainId === PHAROS_ATLANTIC_CHAIN_ID) return PHAROS_ATLANTIC.id;
  return undefined;
}

/**
 * Convert a human decimal amount ("0.25", 12.5) to base units without float
 * rounding drift. Throws on negatives, NaN, or more fractional digits than
 * the token supports.
 */
export function toBaseUnits(
  symbol: TokenSymbol,
  amount: string | number,
): BaseUnits {
  const decimals = tokenDecimals(symbol);
  const raw =
    typeof amount === "number"
      ? Number.isFinite(amount)
        ? amount.toFixed(decimals)
        : "NaN"
      : amount.trim();
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(raw);
  if (!m) throw new RangeError(`invalid ${symbol} amount: ${String(amount)}`);
  const [, whole, frac = ""] = m;
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    throw new RangeError(
      `${symbol} supports at most ${decimals} decimals: ${String(amount)}`,
    );
  }
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((frac.slice(0, decimals) || "0").padEnd(decimals, "0"));
  return units.toString() as BaseUnits;
}

/** Format base units as a human string, e.g. `25000000` ZEC → `"0.25 ZEC"`. */
export function formatBaseUnits(symbol: TokenSymbol, units: BaseUnits): string {
  const decimals = tokenDecimals(symbol);
  const v = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  const frac = (v % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} ${symbol}`;
}

/** USDC amount whose base units are the 6-decimal encoding of `usd`. */
export function usdcAmount(
  usd: number | string,
  chainId: EvmChainId = DEFAULT_CHAIN_ID.USDC,
): UsdcPaymentAmount {
  return {
    tokenSymbol: "USDC",
    chainId,
    amountBaseUnits: toBaseUnits("USDC", usd),
  };
}

/** ZEC amount from a human ZEC value (`"0.25"`) or explicit zatoshis. */
export function zecAmount(
  zec: number | string | { zatoshis: bigint | BaseUnits },
  chainId: ZcashChainId = DEFAULT_CHAIN_ID.ZEC,
): ZecPaymentAmount {
  const amountBaseUnits =
    typeof zec === "object"
      ? (BigInt(zec.zatoshis).toString() as BaseUnits)
      : toBaseUnits("ZEC", zec);
  return { tokenSymbol: "ZEC", chainId, amountBaseUnits };
}

/**
 * Scale `amount` by `numeratorUsd / denominatorUsd` (both USD), using the
 * intent's own USD quote as the implied rate. Used to express a contracted
 * USD price in the payment token's base units. Integer math at 1e-6 USD.
 */
export function scaleBaseUnitsByUsd(
  amount: BaseUnits,
  numeratorUsd: number,
  denominatorUsd: number,
): BaseUnits {
  if (!(denominatorUsd > 0) || !(numeratorUsd >= 0)) return amount;
  const num = BigInt(Math.round(numeratorUsd * 1e6));
  const den = BigInt(Math.round(denominatorUsd * 1e6));
  if (den === 0n) return amount;
  return ((BigInt(amount) * num + den / 2n) / den).toString() as BaseUnits;
}

/**
 * Validate an untyped `{ tokenSymbol, chainId, amountBaseUnits }` triple
 * (JSON body or query string). Returns the typed amount or an error message.
 *
 * Back-compat: a request with no `tokenSymbol` is a USDC payment on the
 * default EVM chain whose base units are derived from `amountUsd`. For USDC,
 * explicit base units must equal the 6-decimal encoding of `amountUsd`.
 */
export function parsePaymentAmount(
  raw: { tokenSymbol?: unknown; chainId?: unknown; amountBaseUnits?: unknown },
  amountUsd: number,
): PaymentAmount | string {
  const symbol = raw.tokenSymbol ?? "USDC";
  if (!isTokenSymbol(symbol)) {
    return `tokenSymbol must be one of ${TOKEN_SYMBOLS.join(", ")}`;
  }
  const chainId = raw.chainId ?? DEFAULT_CHAIN_ID[symbol];
  if (!chainMatchesToken(symbol, chainId)) {
    return symbol === "ZEC"
      ? "chainId for ZEC must be zcash:testnet or zcash:mainnet"
      : "chainId for USDC must be a CAIP-2 EVM id (eip155:<n>)";
  }

  let units: BaseUnits | undefined;
  if (raw.amountBaseUnits !== undefined && raw.amountBaseUnits !== null) {
    const v =
      typeof raw.amountBaseUnits === "number" &&
      Number.isSafeInteger(raw.amountBaseUnits)
        ? String(raw.amountBaseUnits)
        : raw.amountBaseUnits;
    if (!isBaseUnits(v) || v === "0") {
      return `amountBaseUnits must be a positive integer string in ${TOKENS[symbol].baseUnit}`;
    }
    units = v;
  }

  if (symbol === "ZEC") {
    if (!units) return "amountBaseUnits (zatoshis) is required for ZEC";
    return {
      tokenSymbol: "ZEC",
      chainId: chainId as ZcashChainId,
      amountBaseUnits: units,
    };
  }

  const derived = toBaseUnits("USDC", amountUsd);
  if (units && units !== derived) {
    return `amountBaseUnits ${units} does not match amountUsd ${amountUsd} (expected ${derived} micro-USDC)`;
  }
  return {
    tokenSymbol: "USDC",
    chainId: chainId as EvmChainId,
    amountBaseUnits: units ?? derived,
  };
}
