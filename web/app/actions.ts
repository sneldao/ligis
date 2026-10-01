"use server";

import { getAddress, type Hex } from "viem";
import { capabilities } from "@/lib/chain";
import {
  isCapableMulti as routerIsCapableMulti,
  readCredential as routerReadCredential,
  isValidAddress,
  isCasperChain,
} from "@/lib/chain-router";
import { verifySubject, resolveCapability } from "@/lib/verify";
import { resolveSubject } from "@/lib/resolve";
import { vouchIssue, vouchRevoke } from "@/lib/vouch";
import {
  chainById,
  getChain,
  isPasskeyIssuer,
  type ChainNetwork,
} from "@/lib/network";
import { subjectChainMismatch } from "@/lib/subject-format";

export type CapabilityResult = {
  id: string;
  label: string;
  hash: Hex;
  capable: boolean;
  issuer: `0x${string}` | null;
  expiresAt: bigint | null;
};

export type VerifyResult =
  | {
      ok: true;
      capable: boolean;
      subject: string;
      capabilityId: string;
      capabilityHash: Hex;
      issuer: `0x${string}` | null;
      expiresAt: bigint | null;
      revoked: boolean;
      /** Registry the featured verdict came from. */
      resolvedChainId: string;
      /** Per-registry evidence — length > 1 for unscoped resolution. */
      provenance: {
        chainId: string;
        name: string;
        capable: boolean;
        revoked: boolean;
        passkey: boolean;
        unreachable: boolean;
      }[];
    }
  | {
      ok: false;
      error: string;
      mismatch?: {
        suggestedChainId: string;
        suggestedChainName: string;
        message: string;
      };
    };

export type BatchVerifyResult =
  | {
      ok: true;
      subject: string;
      results: CapabilityResult[];
      rpcCalls: number;
      /** Registry the batch read ran against. */
      resolvedChainId: string;
    }
  | {
      ok: false;
      error: string;
      mismatch?: {
        suggestedChainId: string;
        suggestedChainName: string;
        message: string;
      };
    };

function resolveChain(form: FormData): ChainNetwork {
  const chainId = String(form.get("chainId") ?? "").trim();
  return getChain({ chain: chainId || undefined });
}

export async function verifyAction(
  _prev: VerifyResult | null,
  form: FormData,
): Promise<VerifyResult> {
  const subjectRaw = String(form.get("subject") ?? "").trim();
  const capabilityId = String(form.get("capability") ?? "").trim();
  const chainId = String(form.get("chainId") ?? "").trim();

  // Unscoped: resolve the subject across every registry it could live on.
  if (!chainId) {
    const res = await resolveSubject(subjectRaw, capabilityId);
    if (!res.ok) return { ok: false, error: res.error };
    const primary = res.primary.outcome;
    if (!primary.ok) return { ok: false, error: "Read failed." };
    return {
      ok: true,
      capable: res.capable,
      subject: res.subject,
      capabilityId: res.capabilityId,
      capabilityHash: primary.capabilityHash,
      issuer: primary.issuer,
      expiresAt: primary.expiresAt,
      revoked: primary.revoked,
      resolvedChainId: res.primary.chain.id,
      provenance: res.verdicts.map((v) => ({
        chainId: v.chain.id,
        name: v.chain.name,
        capable: v.outcome.ok && v.outcome.capable,
        revoked: v.outcome.ok && v.outcome.revoked,
        passkey: v.outcome.ok && isPasskeyIssuer(v.outcome.issuer, v.chain.id),
        unreachable: !v.outcome.ok,
      })),
    };
  }

  const chain = resolveChain(form);
  if (!isValidAddress(chain, subjectRaw)) {
    const mismatch = subjectChainMismatch(chain, subjectRaw);
    return {
      ok: false,
      error: mismatch
        ? mismatch.message
        : `Subject must be a valid ${isCasperChain(chain) ? "Casper account hash (account-hash-...)" : "0x-prefixed 20-byte address"}.`,
      mismatch: mismatch ?? undefined,
    };
  }

  const outcome = await verifySubject(chain, subjectRaw, capabilityId);
  if (!outcome.ok) return outcome;
  return {
    ...outcome,
    resolvedChainId: chain.id,
    provenance: [
      {
        chainId: chain.id,
        name: chain.name,
        capable: outcome.capable,
        revoked: outcome.revoked,
        passkey: isPasskeyIssuer(outcome.issuer, chain.id),
        unreachable: false,
      },
    ],
  };
}

export async function batchVerifyAction(
  _prev: BatchVerifyResult | null,
  form: FormData,
): Promise<BatchVerifyResult> {
  const chain = resolveChain(form);
  const subjectRaw = String(form.get("subject") ?? "").trim();

  if (!isValidAddress(chain, subjectRaw)) {
    const mismatch = subjectChainMismatch(chain, subjectRaw);
    return {
      ok: false,
      error: mismatch
        ? mismatch.message
        : `Subject must be a valid ${isCasperChain(chain) ? "Casper account hash (account-hash-...)" : "0x-prefixed 20-byte address"}.`,
      mismatch: mismatch ?? undefined,
    };
  }

  const subject = isCasperChain(chain) ? subjectRaw : getAddress(subjectRaw);
  const hashes = capabilities.map((c) => c.hash);

  try {
    const capableResults = await routerIsCapableMulti(chain, subject, hashes);
    const results: CapabilityResult[] = await Promise.all(
      capabilities.map(async (cap, i) => {
        const capable = capableResults[i];
        if (!capable) {
          return {
            id: cap.id,
            label: cap.label,
            hash: cap.hash,
            capable: false,
            issuer: null,
            expiresAt: null,
          };
        }
        const view = await routerReadCredential(chain, subject, cap.hash).catch(
          () => null,
        );
        return {
          id: cap.id,
          label: cap.label,
          hash: cap.hash,
          capable: true,
          issuer: view?.issuer ?? null,
          expiresAt: view?.expiresAt ?? null,
        };
      }),
    );

    return {
      ok: true,
      subject,
      results,
      rpcCalls: isCasperChain(chain) ? hashes.length : 1,
      resolvedChainId: chain.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Read failed against ${chain.name}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------- Issuer desk ----------

export type VouchResult =
  | {
      ok: true;
      action: "issue" | "revoke";
      subject: string;
      capabilityId: string;
      chainId: string;
      txs: string[];
      /** Gate read after the write — the wedge closing the loop. */
      capable: boolean;
    }
  | { ok: false; error: string };

export async function vouchAction(
  _prev: VouchResult | null,
  form: FormData,
): Promise<VouchResult> {
  const chainId = String(form.get("chainId") ?? "").trim();
  const chain = chainById(chainId);
  if (!chain || chain.kind !== "evm") {
    return { ok: false, error: "Vouching is wired for the EVM registries." };
  }
  const subject = String(form.get("subject") ?? "").trim();
  if (!isValidAddress(chain, subject)) {
    return { ok: false, error: "Subject must be a 0x-prefixed EVM address." };
  }
  const capabilityId = String(form.get("capability") ?? "").trim();
  const cap = resolveCapability(capabilityId);
  if (!cap) {
    return {
      ok: false,
      error: `Unknown capability "${capabilityId}". Available: ${capabilities.map((c) => c.id).join(", ")}.`,
    };
  }
  const action =
    String(form.get("intent") ?? "").trim() === "revoke" ? "revoke" : "issue";

  try {
    if (action === "revoke") {
      const { txs, revoked } = await vouchRevoke({
        chain,
        subject: subject as `0x${string}`,
        capabilityId: cap.id,
      });
      if (revoked === 0) {
        return {
          ok: false,
          error:
            "Nothing to pull back — the demo issuer holds no live credential for that pair.",
        };
      }
      const outcome = await verifySubject(chain, subject, capabilityId);
      return {
        ok: true,
        action,
        subject,
        capabilityId: cap.id,
        chainId: chain.id,
        txs,
        capable: outcome.ok && outcome.capable,
      };
    }

    const { tx } = await vouchIssue({
      chain,
      subject: subject as `0x${string}`,
      capabilityId: cap.id,
    });
    const outcome = await verifySubject(chain, subject, capabilityId);
    return {
      ok: true,
      action,
      subject,
      capabilityId,
      chainId: chain.id,
      txs: [tx],
      capable: outcome.ok && outcome.capable,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Write failed on ${chain.name}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
