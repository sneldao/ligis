"use server";

import { getAddress, type Hex } from "viem";
import {
  capabilities,
  isCapable,
  isCapableMulti,
  network,
  readCredential,
} from "@/lib/chain";
import { isAddressLike } from "@/lib/format";

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
      subject: `0x${string}`;
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
      subject: `0x${string}`;
      results: CapabilityResult[];
      rpcCalls: number;
    }
  | { ok: false; error: string };

export async function verifyAction(
  _prev: VerifyResult | null,
  form: FormData
): Promise<VerifyResult> {
  const subjectRaw = String(form.get("subject") ?? "").trim();
  const capabilityId = String(form.get("capability") ?? "").trim();

  if (!isAddressLike(subjectRaw)) {
    return { ok: false, error: "Subject must be a 0x-prefixed 20-byte address." };
  }
  const cap = capabilities.find((c) => c.id === capabilityId);
  if (!cap) {
    return { ok: false, error: "Unknown capability." };
  }

  const subject = getAddress(subjectRaw);

  try {
    const capable = await isCapable(subject, cap.hash);
    if (!capable) {
      return {
        ok: true,
        capable: false,
        subject,
        capabilityId: cap.id,
        capabilityHash: cap.hash,
        issuer: null,
        expiresAt: null,
        revoked: false,
      };
    }
    const view = await readCredential(subject, cap.hash);
    return {
      ok: true,
      capable: true,
      subject,
      capabilityId: cap.id,
      capabilityHash: cap.hash,
      issuer: view.issuer,
      expiresAt: view.expiresAt,
      revoked: view.revoked,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Read failed against ${network.name}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function batchVerifyAction(
  _prev: BatchVerifyResult | null,
  form: FormData
): Promise<BatchVerifyResult> {
  const subjectRaw = String(form.get("subject") ?? "").trim();

  if (!isAddressLike(subjectRaw)) {
    return { ok: false, error: "Subject must be a 0x-prefixed 20-byte address." };
  }

  const subject = getAddress(subjectRaw);
  const hashes = capabilities.map((c) => c.hash);

  try {
    const capableResults = await isCapableMulti(subject, hashes);
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
        const view = await readCredential(subject, cap.hash).catch(() => null);
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
      rpcCalls: 1,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Read failed against ${network.name}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
