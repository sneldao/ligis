"use server";

import { getAddress, type Hex } from "viem";
import { capabilities } from "@/lib/chain";
import {
  isCapableMulti as routerIsCapableMulti,
  readCredential as routerReadCredential,
  isValidAddress,
  isCasperChain,
} from "@/lib/chain-router";
import { verifySubject } from "@/lib/verify";
import { getChain, type ChainNetwork } from "@/lib/network";

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
    }
  | { ok: false; error: string };

export type BatchVerifyResult =
  | {
      ok: true;
      subject: string;
      results: CapabilityResult[];
      rpcCalls: number;
    }
  | { ok: false; error: string };

function resolveChain(form: FormData): ChainNetwork {
  const chainId = String(form.get("chainId") ?? "").trim();
  return getChain({ chain: chainId || undefined });
}

export async function verifyAction(
  _prev: VerifyResult | null,
  form: FormData
): Promise<VerifyResult> {
  const chain = resolveChain(form);
  const subjectRaw = String(form.get("subject") ?? "").trim();
  const capabilityId = String(form.get("capability") ?? "").trim();

  if (!isValidAddress(chain, subjectRaw)) {
    return {
      ok: false,
      error: `Subject must be a valid ${isCasperChain(chain) ? "Casper account hash (account-hash-...)" : "0x-prefixed 20-byte address"}.`,
    };
  }

  return verifySubject(chain, subjectRaw, capabilityId);
}

export async function batchVerifyAction(
  _prev: BatchVerifyResult | null,
  form: FormData
): Promise<BatchVerifyResult> {
  const chain = resolveChain(form);
  const subjectRaw = String(form.get("subject") ?? "").trim();

  if (!isValidAddress(chain, subjectRaw)) {
    return {
      ok: false,
      error: `Subject must be a valid ${isCasperChain(chain) ? "Casper account hash (account-hash-...)" : "0x-prefixed 20-byte address"}.`,
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
        const view = await routerReadCredential(chain, subject, cap.hash).catch(() => null);
        return {
          id: cap.id,
          label: cap.label,
          hash: cap.hash,
          capable: true,
          issuer: view?.issuer ?? null,
          expiresAt: view?.expiresAt ?? null,
        };
      })
    );

    return {
      ok: true,
      subject,
      results,
      rpcCalls: isCasperChain(chain) ? hashes.length : 1,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Read failed against ${chain.name}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
