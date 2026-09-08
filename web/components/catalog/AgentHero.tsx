"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AgentPortrait } from "@/components/AgentPortrait";

const HeroScene = dynamic(
  () => import("./HeroScene").then((m) => m.HeroScene),
  {
    ssr: false,
    loading: () => null,
  },
);

export function AgentHero({
  address,
  heldCount,
  fieldHref,
}: {
  address: string;
  heldCount: number;
  fieldHref: string;
}) {
  return (
    <div className="relative h-[60vh] min-h-[26rem] w-full overflow-hidden bg-paper sm:h-[68vh]">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="aspect-[4/5] h-[80%] max-h-[34rem] opacity-90">
          <AgentPortrait address={address} className="h-full w-full" />
        </div>
      </div>
      <div className="absolute inset-0">
        <HeroScene address={address} heldCount={heldCount} />
      </div>
      <Link
        href={fieldHref}
        className="absolute bottom-5 left-5 z-10 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-terra sm:bottom-8 sm:left-8"
      >
        ← Back to the field
      </Link>
    </div>
  );
}
