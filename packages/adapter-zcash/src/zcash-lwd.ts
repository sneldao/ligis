/**
 * Live Zcash light-client reads for the Ligis shielded adapter.
 *
 * - `LightwalletdClient`: minimal gRPC-over-HTTP/2 client (node:http2, no
 *   protobuf/gRPC dependency) for `CompactTxStreamer.GetTransaction` and
 *   `GetLatestBlock` against any lightwalletd/Zaino endpoint.
 * - ZIP-316 decoding (Bech32m + F4Jumble) of Unified Addresses and Unified
 *   Incoming Viewing Keys.
 * - Orchard/Ironwood in-band note trial decryption (Pallas ECDH, BLAKE2b KDF,
 *   ChaCha20-Poly1305) so a payee's disclosed viewing key can read the
 *   512-byte `LIGIS:v1:` memo straight from a confirmed transaction.
 *
 * Scope: Orchard + Ironwood receivers of v5/v6 transactions. Sapling-only
 * notes are not decrypted here. The diversifier check binds a note to the
 * claimed address; pk_d is not re-derived.
 */
import { createDecipheriv } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import { pallas } from "@noble/curves/pasta";
import { blake2b } from "@noble/hashes/blake2b";

// ─── ZIP-316: Bech32m + F4Jumble ────────────────────────────────────────

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32mDecode(str: string): { hrp: string; bytes: Uint8Array } {
  const input = str.trim();
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) {
    throw new Error("mixed-case bech32m string");
  }
  const s = input.toLowerCase();
  const pos = s.lastIndexOf("1");
  if (pos < 1 || s.length - pos < 7 || s.length > 2048) {
    throw new Error("not a bech32m string");
  }
  const hrp = s.slice(0, pos);
  const values = [...s.slice(pos + 1)].map((c) => {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error("invalid bech32m character");
    return v;
  });
  const expanded = [
    ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((c) => c.charCodeAt(0) & 31),
    ...values,
  ];
  const generators = [
    0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
  ];
  let checksum = 1;
  for (const value of expanded) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) checksum ^= generators[i]!;
    }
  }
  if (checksum >>> 0 !== 0x2bc830a3) {
    throw new Error("invalid bech32m checksum");
  }
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = pos + 1; i < s.length - 6; i++) {
    const v = CHARSET.indexOf(s[i]!);
    if (v < 0) throw new Error("invalid bech32m character");
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= 0xff;
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 255) !== 0) {
    throw new Error("noncanonical bech32m padding");
  }
  return { hrp, bytes: Uint8Array.from(out) };
}

function f4JumbleInv(input: Uint8Array): Uint8Array {
  const buf = Uint8Array.from(input);
  const lLen = Math.min(64, Math.floor(buf.length / 2));
  const L = buf.subarray(0, lLen);
  const R = buf.subarray(lLen);
  const H = (i: number, right: Uint8Array) => {
    const pers = new TextEncoder().encode("UA_F4Jumble_H___");
    pers[13] = i;
    pers[14] = 0;
    pers[15] = 0;
    return blake2b(right, { dkLen: lLen, personalization: pers });
  };
  const G = (i: number, left: Uint8Array) => {
    const out = new Uint8Array(R.length);
    for (let j = 0; j * 64 < R.length; j++) {
      const pers = new TextEncoder().encode("UA_F4Jumble_G___");
      pers[13] = i;
      pers[14] = j & 0xff;
      pers[15] = (j >> 8) & 0xff;
      const chunk = blake2b(left, { dkLen: 64, personalization: pers });
      out.set(chunk.subarray(0, Math.min(64, R.length - j * 64)), j * 64);
    }
    return out;
  };
  const xor = (a: Uint8Array, b: Uint8Array) => {
    for (let k = 0; k < a.length; k++) a[k]! ^= b[k]!;
  };
  xor(L, H(1, R));
  xor(R, G(1, L));
  xor(L, H(0, R));
  xor(R, G(0, L));
  return buf;
}

/** Decode a Unified Address / UIVK into its typecode → receiver bytes map. */
export function parseUnifiedReceivers(encoded: string): {
  hrp: string;
  receivers: Map<number, Uint8Array>;
} {
  const { hrp, bytes } = bech32mDecode(encoded);
  if (!["u", "utest", "uivk", "uivktest"].includes(hrp)) {
    throw new Error("unsupported unified HRP");
  }
  if (bytes.length < 48 || bytes.length > 1024) {
    throw new Error("unsupported unified encoding length");
  }
  const un = f4JumbleInv(bytes);
  const expectedPadding = new Uint8Array(16);
  expectedPadding.set(new TextEncoder().encode(hrp));
  if (
    !Buffer.from(un.subarray(un.length - 16)).equals(
      Buffer.from(expectedPadding),
    )
  ) {
    throw new Error("unified encoding failed its HRP padding check");
  }
  const receivers = new Map<number, Uint8Array>();
  let o = 0;
  let previousType = -1;
  const end = un.length - 16;
  while (o < end) {
    const type = compactSize(un, o);
    const len = compactSize(un, type.next);
    o = len.next;
    if (type.v <= previousType || o + len.v > end) {
      throw new Error("invalid unified receiver ordering or length");
    }
    previousType = type.v;
    receivers.set(type.v, un.subarray(o, o + len.v));
    o += len.v;
  }
  return { hrp, receivers };
}

const ORCHARD_TYPECODE = 3;

/** Orchard (11-byte diversifier ‖ 32-byte pk_d) receiver of a Unified Address. */
export function orchardReceiverOf(ua: string): Uint8Array | null {
  const r = parseUnifiedReceivers(ua).receivers.get(ORCHARD_TYPECODE);
  return r && r.length === 43 ? r : null;
}

function orchardIvkScalar(uivk: string): bigint {
  const r = parseUnifiedReceivers(uivk).receivers.get(ORCHARD_TYPECODE);
  if (!r || r.length !== 64) {
    throw new Error("viewing key has no Orchard component");
  }
  let n = 0n;
  for (let i = 63; i >= 32; i--) n = (n << 8n) | BigInt(r[i]!);
  return n;
}

// ─── Transaction action parsing ─────────────────────────────────────────

export interface ShieldedAction {
  pool: "orchard" | "ironwood";
  nullifier: Uint8Array;
  cmx: Uint8Array;
  epk: Uint8Array;
  encCiphertext: Uint8Array;
}

function compactSize(b: Uint8Array, o: number): { v: number; next: number } {
  if (!Number.isSafeInteger(o) || o < 0 || o >= b.length) {
    throw new Error("truncated compact size");
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const f = b[o]!;
  if (f < 253) return { v: f, next: o + 1 };
  const width = f === 253 ? 2 : f === 254 ? 4 : 8;
  if (o + 1 + width > b.length) throw new Error("truncated compact size");
  const v =
    width === 2
      ? dv.getUint16(o + 1, true)
      : width === 4
        ? dv.getUint32(o + 1, true)
        : Number(dv.getBigUint64(o + 1, true));
  if (
    !Number.isSafeInteger(v) ||
    v < (width === 2 ? 253 : width === 4 ? 65536 : 4294967296)
  ) {
    throw new Error("noncanonical compact size");
  }
  return { v, next: o + 1 + width };
}

/** Extract Orchard (and, for v6, Ironwood) actions from a raw v5/v6 transaction. */
export function parseShieldedActions(tx: Uint8Array): ShieldedAction[] {
  if (tx.length < 20 || tx.length > 2_000_000)
    throw new Error("invalid transaction length");
  const dv = new DataView(tx.buffer, tx.byteOffset, tx.byteLength);
  const header = dv.getUint32(0, true);
  const version = header & 0x7fffffff;
  if (!(header & 0x80000000) || (version !== 5 && version !== 6)) {
    throw new Error("unsupported transaction version");
  }
  let p = 20;
  const vin = compactSize(tx, p);
  p = vin.next;
  for (let i = 0; i < vin.v; i++) {
    p += 36;
    const sc = compactSize(tx, p);
    p = sc.next + sc.v + 4;
  }
  const vout = compactSize(tx, p);
  p = vout.next;
  for (let i = 0; i < vout.v; i++) {
    p += 8;
    const spk = compactSize(tx, p);
    p = spk.next + spk.v;
  }
  const spends = compactSize(tx, p);
  p = spends.next + spends.v * 96;
  const outputs = compactSize(tx, p);
  p = outputs.next + outputs.v * 756;
  if (spends.v + outputs.v > 0) {
    p += 8;
    if (spends.v > 0) p += 32;
    p += spends.v * 256 + outputs.v * 192 + 64;
  }
  const pools: Array<"orchard" | "ironwood"> =
    version >= 6 ? ["orchard", "ironwood"] : ["orchard"];
  const actions: ShieldedAction[] = [];
  for (const pool of pools) {
    const n = compactSize(tx, p);
    p = n.next;
    if (n.v > Math.floor((tx.length - p) / 820)) {
      throw new Error("truncated shielded actions");
    }
    for (let i = 0; i < n.v; i++) {
      const nullifier = tx.subarray(p + 32, p + 64);
      const cmx = tx.subarray(p + 96, p + 128);
      const epk = tx.subarray(p + 128, p + 160);
      const encCiphertext = tx.subarray(p + 160, p + 740);
      p += 820; // cv nf rk cmx epk enc(580) out(80)
      actions.push({ pool, nullifier, cmx, epk, encCiphertext });
    }
    if (n.v > 0) {
      p += 1 + 8 + 32;
      const proof = compactSize(tx, p);
      p = proof.next + proof.v + n.v * 64 + 64;
      if (p > tx.length) throw new Error("truncated shielded bundle");
    }
  }
  if (p !== tx.length) throw new Error("unexpected trailing transaction data");
  return actions;
}

// ─── Note trial decryption ──────────────────────────────────────────────

function pointFromZcashBytes(b32: Uint8Array) {
  const b = Uint8Array.from(b32);
  const sign = (b[31]! >> 7) & 1;
  b[31]! &= 0x7f;
  const sec1 = new Uint8Array(33);
  sec1[0] = sign ? 0x03 : 0x02;
  for (let i = 0; i < 32; i++) sec1[1 + i] = b[31 - i]!;
  return pallas.Point.fromHex(sec1);
}

function zcashBytesFromPoint(pt: { toAffine(): { x: bigint; y: bigint } }) {
  const { x, y } = pt.toAffine();
  const out = new Uint8Array(32);
  let t = x;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  if ((y & 1n) === 1n) out[31]! |= 0x80;
  return out;
}

export interface DecryptedNote {
  pool: "orchard" | "ironwood";
  valueZat: bigint;
  /** 11-byte diversifier, hex. */
  diversifier: string;
  nullifier: string;
  cmx: string;
  /** Memo bytes up to the first 0x00 / 0xf6 terminator, as UTF-8. */
  memo: string;
}

/** Trial-decrypt every action in `tx` with a Unified Incoming Viewing Key. */
export function decryptNotesWithViewingKey(
  tx: Uint8Array,
  uivk: string,
): DecryptedNote[] {
  const ivk = orchardIvkScalar(uivk);
  const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
  const notes: DecryptedNote[] = [];
  for (const a of parseShieldedActions(tx)) {
    try {
      const shared = zcashBytesFromPoint(
        pointFromZcashBytes(a.epk).multiply(ivk),
      );
      const key = blake2b(Uint8Array.from([...shared, ...a.epk]), {
        dkLen: 32,
        personalization: new TextEncoder().encode("Zcash_OrchardKDF"),
      });
      const d = createDecipheriv("chacha20-poly1305", key, Buffer.alloc(12), {
        authTagLength: 16,
      });
      d.setAuthTag(Buffer.from(a.encCiphertext.subarray(564, 580)));
      const pt = Buffer.concat([
        d.update(a.encCiphertext.subarray(0, 564)),
        d.final(),
      ]);
      // lead byte: 0x02 Orchard notes, 0x03 Ironwood notes
      if (pt[0] !== (a.pool === "orchard" ? 0x02 : 0x03)) continue;
      const memoRaw = pt.subarray(52, 564);
      const end = memoRaw.findIndex((x) => x === 0 || x === 0xf6);
      notes.push({
        pool: a.pool,
        valueZat: pt.readBigUInt64LE(12),
        diversifier: hex(pt.subarray(1, 12)),
        nullifier: `0x${hex(a.nullifier)}`,
        cmx: `0x${hex(a.cmx)}`,
        memo: memoRaw.subarray(0, end === -1 ? 512 : end).toString("utf8"),
      });
    } catch {
      // not addressed to this key (AEAD failure / invalid point)
    }
  }
  return notes;
}

// ─── lightwalletd gRPC (HTTP/2) ─────────────────────────────────────────

export interface ZcashLightClient {
  getTransaction(txid: string): Promise<{ raw: Uint8Array; height: number }>;
  getLatestHeight(): Promise<number>;
  close?(): void;
}

function varint(b: Uint8Array, o: number): { v: number; next: number } {
  let v = 0;
  let s = 0;
  for (let i = 0; i < 8; i++) {
    if (o >= b.length) throw new Error("truncated protobuf varint");
    const byte = b[o++]!;
    v += (byte & 0x7f) * 2 ** s;
    if (!Number.isSafeInteger(v)) throw new Error("protobuf integer overflow");
    if (!(byte & 0x80)) return { v, next: o };
    s += 7;
  }
  throw new Error("protobuf varint too long");
}

/** Walk a protobuf message and return `{field → [raw values]}` (varint or bytes). */
function protoFields(b: Uint8Array): Map<number, Array<number | Uint8Array>> {
  const out = new Map<number, Array<number | Uint8Array>>();
  let o = 0;
  while (o < b.length) {
    const tag = varint(b, o);
    o = tag.next;
    const field = Math.floor(tag.v / 8);
    const wire = tag.v & 7;
    let val: number | Uint8Array;
    if (wire === 0) {
      const v = varint(b, o);
      o = v.next;
      val = v.v;
    } else if (wire === 2) {
      const l = varint(b, o);
      o = l.next;
      if (o + l.v > b.length) throw new Error("truncated protobuf field");
      val = b.subarray(o, o + l.v);
      o += l.v;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
    const arr = out.get(field) ?? [];
    arr.push(val);
    out.set(field, arr);
  }
  return out;
}

export class LightwalletdClient implements ZcashLightClient {
  private session?: ClientHttp2Session;
  constructor(
    private readonly url = "https://testnet.zec.rocks:443",
    private readonly timeoutMs = 10_000,
  ) {}

  private call(method: string, payload: Uint8Array): Promise<Uint8Array> {
    if (!this.session || this.session.closed || this.session.destroyed) {
      const session = connect(this.url);
      session.on("error", () => {
        if (this.session === session) this.session = undefined;
      });
      this.session = session;
    }
    return new Promise((resolve, reject) => {
      const frame = Buffer.alloc(5 + payload.length);
      frame.writeUInt32BE(payload.length, 1);
      frame.set(payload, 5);
      const req = this.session!.request({
        ":method": "POST",
        ":path": `/cash.z.wallet.sdk.rpc.CompactTxStreamer/${method}`,
        "content-type": "application/grpc",
        te: "trailers",
      });
      const timer = setTimeout(() => {
        req.close();
        reject(new Error(`lightwalletd ${method} timed out`));
      }, this.timeoutMs);
      const chunks: Buffer[] = [];
      let grpcStatus: string | undefined;
      let grpcMessage: string | undefined;
      req.on("trailers", (t) => {
        grpcStatus = String(t["grpc-status"] ?? "");
        grpcMessage = String(t["grpc-message"] ?? "");
      });
      let receivedBytes = 0;
      req.on("response", (headers) => {
        if (headers["grpc-status"] !== undefined) {
          grpcStatus = String(headers["grpc-status"]);
          grpcMessage = String(headers["grpc-message"] ?? "");
        }
        if (headers[":status"] !== 200) {
          clearTimeout(timer);
          reject(new Error(`lightwalletd HTTP ${headers[":status"]}`));
          req.close();
        }
      });
      req.on("data", (c: Buffer) => {
        receivedBytes += c.length;
        if (receivedBytes > 2_000_005) {
          clearTimeout(timer);
          reject(new Error("lightwalletd response exceeds size limit"));
          req.close();
          return;
        }
        chunks.push(c);
      });
      req.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      req.on("end", () => {
        clearTimeout(timer);
        if (grpcStatus !== "0") {
          reject(
            new Error(`lightwalletd ${method}: ${grpcMessage || grpcStatus}`),
          );
          return;
        }
        const buf = Buffer.concat(chunks);
        if (buf.length < 5) {
          reject(new Error(`lightwalletd ${method}: empty response`));
          return;
        }
        const length = buf.readUInt32BE(1);
        if (buf[0] !== 0 || length !== buf.length - 5) {
          reject(new Error("invalid or compressed gRPC response frame"));
          return;
        }
        resolve(buf.subarray(5));
      });
      req.end(frame);
    });
  }

  async getTransaction(txid: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error("invalid txid");
    const hash = Buffer.from(txid, "hex").reverse();
    const res = await this.call(
      "GetTransaction",
      Buffer.concat([Buffer.from([0x1a, 0x20]), hash]),
    );
    const f = protoFields(res);
    const raw = f.get(1)?.[0];
    if (!(raw instanceof Uint8Array)) throw new Error("transaction not found");
    return { raw, height: Number(f.get(2)?.[0] ?? 0) };
  }

  async getLatestHeight() {
    const res = await this.call("GetLatestBlock", new Uint8Array());
    return Number(protoFields(res).get(1)?.[0] ?? 0);
  }

  close() {
    this.session?.close();
    this.session = undefined;
  }
}

// ─── Attestation read ───────────────────────────────────────────────────

export interface LiveAttestation {
  txid: string;
  height: number;
  pool: "orchard" | "ironwood";
  valueZat: bigint;
  nullifier: string;
  memo: string;
}

/**
 * Fetch `txid`, decrypt with the payee's disclosed UIVK, and return the notes
 * addressed to `ua`'s Orchard receiver (diversifier-matched).
 */
export async function readNotesForAddress(opts: {
  client: ZcashLightClient;
  txid: string;
  ua: string;
  uivk: string;
}): Promise<LiveAttestation[]> {
  const addressHrp = parseUnifiedReceivers(opts.ua).hrp;
  const keyHrp = parseUnifiedReceivers(opts.uivk).hrp;
  if (
    (addressHrp !== "u" && addressHrp !== "utest") ||
    keyHrp !== (addressHrp === "u" ? "uivk" : "uivktest")
  ) {
    throw new Error("address and viewing key network mismatch");
  }
  const recv = orchardReceiverOf(opts.ua);
  if (!recv) throw new Error("address has no Orchard receiver");
  const div = Buffer.from(recv.subarray(0, 11)).toString("hex");
  const { raw, height } = await opts.client.getTransaction(opts.txid);
  return decryptNotesWithViewingKey(raw, opts.uivk)
    .filter((n) => n.diversifier === div)
    .map((n) => ({
      txid: opts.txid.toLowerCase(),
      height,
      pool: n.pool,
      valueZat: n.valueZat,
      nullifier: n.nullifier,
      memo: n.memo,
    }));
}
