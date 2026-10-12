"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { counterAction } from "@/app/actions/counter";
import type { CounterBucket } from "@/lib/counters";

/**
 * Wraps a Link with a privacy-light fire-and-forget counter on click.
 *
 * Only the bucket ID is sent — no href, no referrer, no payload. The
 * server action validates against the allowlist before recording, so a
 * crafted href cannot inject richer data into the log.
 */
export function HeroCtaCounter({
  bucket,
  children,
  ...props
}: { bucket: CounterBucket } & ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={() => {
        // best-effort; the server action is fire-and-forget and never blocks nav
        void counterAction("hero_cta_click", bucket);
      }}
    >
      {children}
    </Link>
  );
}

/** Variant that wraps a non-Link child (e.g. the "Try the gate →" anchor). */
export function HeroCtaButton({
  bucket,
  children,
  onClick,
  ...props
}: {
  bucket: CounterBucket;
  children: ReactNode;
  onClick?: ComponentProps<"button">["onClick"];
} & Omit<ComponentProps<"button">, "onClick" | "children">) {
  return (
    <button
      type="button"
      {...props}
      onClick={(e) => {
        void counterAction("hero_cta_click", bucket);
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
