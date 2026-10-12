"use server";

/**
 * Counter server actions — fire-and-forget telemetry for the landing CTAs,
 * the /gate form, and share-link opens.
 *
 * Privacy: no PII. The action receives a fixed bucket from a server-side
 * allowlist; the client cannot inject arbitrary categories. The bucket
 * names tell us *what happened*, not *to whom*.
 */
import { record, type CounterBucket } from "@/lib/counters";

const ALLOWED: ReadonlySet<CounterBucket> = new Set<CounterBucket>([
  "hero:gate",
  "hero:arena",
  "hero:proofs",
  "share:gate",
  "share:arena",
  "gate:preset:legit",
  "gate:preset:overpay",
  "gate:preset:injected",
  "gate:custom",
]);

function isBucket(v: unknown): v is CounterBucket {
  return typeof v === "string" && ALLOWED.has(v as CounterBucket);
}

export async function counterAction(
  category: "hero_cta_click" | "gate_run" | "share_link_open",
  bucket: string,
): Promise<void> {
  if (!isBucket(bucket)) return;
  record(category, bucket);
}
