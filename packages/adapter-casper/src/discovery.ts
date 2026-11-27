/**
 * Ligis discovery indexer (M4) — reconstructs the credential economy from
 * Casper blocks. Casper has no event logs, so this scans transactions and
 * decodes entry-point args, same approach as web/lib/chain-casper.ts but
 * unfiltered: every issue/revoke/outcome/accreditation in range.
 *
 * Usage:
 *   export $(grep -v '^#' ../../.env.d/casper.env | grep -v '^$' | xargs)
 *   npx tsx src/discovery.ts [--from <block>] [--to <block>] [--out index.json]
 *
 * Output JSON shape:
 *   {
 *     claims: { "<claim>": { "holders": [...], "issuers": [...], "lastBlock": n } },
 *     namespaces: { "<nsHashHex>": { "accreditationRequired": bool } },
 *     accreditations: { "<issuerHex>:<nsHashHex>": bool },
 *     outcomes: { "<subjectHex>:<claimHashHex>": { total, settled, disputed, rejected, lastKind, lastBlock } },
 *     scannedBlocks: [from, to]
 *   }
 */
import { writeFileSync } from "node:fs";
import { buildCasperClient } from "./client.js";
import { loadCasperConfig } from "./config.js";
import { claimHash, canonicalizeClaim, namespaceOf } from "@ligis/core";

function hex(u8: Uint8Array): string {
  return (
    "0x" +
    Array.from(u8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function argBytes(arg: any): Uint8Array | null {
  const d = arg?.value?.data ?? arg?.data ?? arg;
  return d instanceof Uint8Array ? d : null;
}
function argStr(arg: any): string | null {
  const d = arg?.value?.data ?? arg?.data ?? arg;
  return typeof d === "string" ? d : d != null ? String(d) : null;
}
function argBool(arg: any): boolean | null {
  const d = arg?.value?.data ?? arg?.data ?? arg;
  if (typeof d === "boolean") return d;
  if (d && typeof d === "object" && "bool" in d)
    return Boolean((d as any).bool);
  return null;
}

async function main() {
  const cfg = loadCasperConfig();
  const { rpc } = buildCasperClient(cfg);
  const credReg = (cfg.deployment.credentialRegistry ?? "")
    .replace(/^hash-/, "")
    .replace(/^contract-package-/, "")
    .replace(/^0x/, "");
  const outcomeFeed = (cfg.deployment.outcomeFeed ?? "")
    .replace(/^hash-/, "")
    .replace(/^contract-package-/, "")
    .replace(/^0x/, "");

  const argv = process.argv.slice(2);
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const head = BigInt(
    ((await (rpc as any).getLatestBlockInfo()) as any)?.block?.header?.height ??
      0,
  );
  const to = BigInt(opt("--to") ?? head.toString());
  const from = BigInt(opt("--from") ?? (to > 2000n ? to - 2000n : 0n));

  const claims = new Map<
    string,
    { holders: Set<string>; issuers: Set<string>; lastBlock: bigint }
  >();
  const namespaces = new Map<string, { accreditationRequired: boolean }>();
  const accreditations = new Map<string, boolean>();
  const outcomes = new Map<
    string,
    {
      total: number;
      settled: number;
      disputed: number;
      rejected: number;
      lastKind: number;
      lastBlock: bigint;
    }
  >();
  /** (subject:claimHash) → issuer hex, for RegistryEvent-compatible output. */
  const issuerByKey = new Map<string, string>();
  const events: any[] = [];

  const norm = (h: any) =>
    String(h?.hash ?? h ?? "")
      .replace(/^hash-/, "")
      .replace(/^contract-package-/, "")
      .replace(/^0x/, "")
      .toLowerCase();

  const BATCH = 20;
  for (let b = from; b <= to; b += BigInt(BATCH)) {
    const blocks = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        b + BigInt(i) <= to
          ? (rpc as any)
              .getBlockByHeight(Number(b + BigInt(i)))
              .catch(() => null)
          : null,
      ),
    );
    for (const bi of blocks) {
      const block = (bi as any)?.block;
      if (!block?.body?.transactions) continue;
      for (const txHash of block.body.transactions) {
        try {
          const tx = ((await (rpc as any).getTransaction(txHash)) as any)
            ?.transaction;
          if (!tx) continue;
          const ep = tx.entryPoint;
          const target = norm(tx.target);
          const args = tx.args instanceof Map ? tx.args : new Map();
          const blockNum = BigInt(block.header.height);

          if (target === credReg && ep === "issue") {
            const subject = argBytes(args.get("subject"));
            if (!subject) continue;
            const subjectHex = "account-hash-" + hex(subject).slice(2);
            const claimStr = argStr(args.get("claim"));
            const chBytes = argBytes(
              args.get("claim_hash") ?? args.get("capability_hash"),
            );
            const issuerBytes = argBytes(args.get("issuer"));
            let claim = claimStr;
            let ch = chBytes ? hex(chBytes) : null;
            if (!claim && !ch) continue;
            if (claim) {
              try {
                claim = canonicalizeClaim(claim);
              } catch {
                /* keep raw */
              }
              ch = ch ?? claimHash(claim);
            }
            const c = claims.get(claim ?? ch!) ?? {
              holders: new Set(),
              issuers: new Set(),
              lastBlock: 0n,
            };
            c.holders.add(subjectHex);
            if (issuerBytes) c.issuers.add(hex(issuerBytes));
            if (blockNum > c.lastBlock) c.lastBlock = blockNum;
            claims.set(claim ?? ch!, c);
            if (issuerBytes && ch) {
              issuerByKey.set(
                `${subjectHex.toLowerCase()}:${ch.toLowerCase()}`,
                hex(issuerBytes),
              );
              const nonce = argBytes(args.get("nonce"));
              const issuedAt = argBytes(args.get("issued_at"));
              const expiresAt = argBytes(args.get("expires_at"));
              const u64le = (b: Uint8Array | null) => {
                if (!b || b.length < 8) return "0";
                const be = [...b.slice(0, 8)].reverse();
                return BigInt(
                  "0x" +
                    be.map((x) => x.toString(16).padStart(2, "0")).join(""),
                ).toString();
              };
              events.push({
                type: "issued",
                issuer: hex(issuerBytes),
                subject: hex(subject),
                capabilityHash: ch,
                nonce: u64le(nonce),
                issuedAt: u64le(issuedAt),
                expiresAt: u64le(expiresAt),
                blockNumber: blockNum.toString(),
                logIndex: events.length,
              });
            }
          } else if (target === credReg && ep === "revoke") {
            const subject = argBytes(args.get("subject"));
            const chBytes = argBytes(
              args.get("claim_hash") ?? args.get("capability_hash"),
            );
            if (!subject || !chBytes) continue;
            const subjectHex = "account-hash-" + hex(subject).slice(2);
            const ch = hex(chBytes);
            // revokes can't be mapped back to a claim string without the index;
            // record under the hash key so consumers can still see activity.
            const c = claims.get(ch) ?? {
              holders: new Set(),
              issuers: new Set(),
              lastBlock: 0n,
            };
            c.lastBlock = blockNum;
            claims.set(ch, c);
            const key = `${subjectHex.toLowerCase()}:${ch.toLowerCase()}`;
            events.push({
              type: "revoked",
              issuer: issuerByKey.get(key) ?? "",
              subject: hex(subject),
              capabilityHash: ch,
              nonce: "0",
              revokedAt: String(Math.floor(Date.now() / 1000)),
              blockNumber: blockNum.toString(),
              logIndex: events.length,
            });
          } else if (target === credReg && ep === "set_namespace_policy") {
            const ns = argBytes(args.get("namespace_hash"));
            const req = argBool(args.get("required"));
            if (ns)
              namespaces.set(hex(ns), { accreditationRequired: req ?? false });
          } else if (target === credReg && ep === "set_issuer_accreditation") {
            const issuer = argBytes(args.get("issuer"));
            const ns = argBytes(args.get("namespace_hash"));
            const active = argBool(args.get("active"));
            if (issuer && ns)
              accreditations.set(`${hex(issuer)}:${hex(ns)}`, active ?? false);
          } else if (
            outcomeFeed &&
            target === outcomeFeed &&
            ep === "record_outcome"
          ) {
            const subject = argBytes(args.get("subject"));
            const ch = argBytes(args.get("claim_hash"));
            const kind = Number(argBytes(args.get("kind"))?.[0] ?? 3);
            if (!subject || !ch) continue;
            const key = `${hex(subject)}:${hex(ch)}`;
            const o = outcomes.get(key) ?? {
              total: 0,
              settled: 0,
              disputed: 0,
              rejected: 0,
              lastKind: 3,
              lastBlock: 0n,
            };
            o.total++;
            o.lastKind = kind;
            o.lastBlock = blockNum;
            if (kind === 0) o.settled++;
            else if (kind === 1) o.disputed++;
            else if (kind === 2) o.rejected++;
            outcomes.set(key, o);
          }
        } catch {
          continue;
        }
      }
    }
    if ((b - from) % 2000n === 0n) console.error(`scanned to block ${b}`);
  }

  const out = {
    scannedBlocks: [from.toString(), to.toString()],
    claims: Object.fromEntries(
      [...claims.entries()].map(([k, v]) => [
        k,
        {
          namespace: (() => {
            try {
              return namespaceOf(k);
            } catch {
              return null;
            }
          })(),
          holders: [...v.holders],
          issuers: [...v.issuers],
          lastBlock: v.lastBlock.toString(),
        },
      ]),
    ),
    namespaces: Object.fromEntries(namespaces),
    accreditations: Object.fromEntries(accreditations),
    outcomes: Object.fromEntries(
      [...outcomes.entries()].map(([k, v]) => [
        k,
        { ...v, lastBlock: v.lastBlock.toString() },
      ]),
    ),
  };

  const eventsPath = opt("--events-out");
  if (eventsPath) {
    writeFileSync(eventsPath, JSON.stringify(events, null, 2));
    console.error(`wrote ${events.length} RegistryEvents → ${eventsPath}`);
  }

  const json = JSON.stringify(out, null, 2);
  const outPath = opt("--out");
  if (outPath) {
    writeFileSync(outPath, json);
    console.error(`wrote ${outPath}`);
  } else {
    console.log(json);
  }
  console.error(
    `done: ${claims.size} claims, ${outcomes.size} outcome series, blocks ${from}-${to}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
