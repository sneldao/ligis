import Link from "next/link";
import type { Metadata } from "next";
import { Rule } from "@/components/Rule";

export const metadata: Metadata = {
  title: "Proofs — Ligis",
  description:
    "Three artifacts, each verifiable in under five minutes, plus the honest ledger of what does not work yet. Structure per docs/consolidation-2026-11.md.",
};

/**
 * `/proofs` — the evidence bench. Three artifacts a skeptic can verify in
 * under five minutes, then the honest ledger of what does not work. The
 * ledger is not a confession booth; it is the artifact that makes the other
 * three believable. Mirrors docs/proofs.md — when one moves, the other moves.
 */

const BENCH = [
  {
    name: "The production gate",
    claim:
      "Live credential verification under on-chain accreditation enforcement. Pick the casper-testnet samples: the verified agent passes, the rwa.accredited fixture passes only because its issuer is accredited on-chain.",
    freshness:
      "Continuous — smoke-tested live in CI on every push and weekly by cron.",
    href: "/gate",
    action: "Try it",
  },
  {
    name: "The procurement controller",
    claim:
      "Order-bound payment control: an agent asks to pay against what the business agreed to buy, and the controller returns GO, STOP or REVIEW against the order and its payment history — never a prompt, deterministic code. Terminal demo: pnpm demo:airwallex.",
    freshness: "Last verified run 2026-11-27.",
    href: null,
    action: null,
  },
  {
    name: "The intent layer",
    claim:
      "Every gate decision carries a typed GO/STOP intent verdict from Jev — scope consistency, amount plausibility, payee match, request normality — measured at 75–160 ms in production, failing open to SKIPPED rather than a silent GO.",
    freshness:
      "Continuous — the daily watchdog probes it and fails if the route dies.",
    href: "/gate",
    action: "See it in a decision",
  },
] as const;

const LEDGER = [
  {
    what: "The gated-vault demo",
    state:
      "Broken at the protocol level — the pre-2.x Odra build cannot receive value on the Casper 2.x runtime. It never verifiably completed end-to-end, and its old success artifact was withdrawn. Repair path documented, not scheduled.",
  },
  {
    what: "The x402 server",
    state:
      "Runs nowhere. There is no hosted instance for a merchant to integrate against — dev-local only. Making the gate reachable is on the consolidation roadmap.",
  },
  {
    what: "GenLayer, Zcash, arena surfaces",
    state:
      "Frozen. Their venues closed in 2026 without wins. The surfaces still render, but they are not maintained evidence and are absent from this bench.",
  },
  {
    what: "Monad and Pharos demo artifacts",
    state:
      "The smoke fixtures pass live, but the demo scripts' recorded runs are months stale. Not citation-grade until re-run.",
  },
] as const;

const HISTORY = [
  {
    venue: "The Agent Arena (Vultr)",
    outcome:
      "Prompt-injected $60k payment stopped live by two intent judges — never reached the wire.",
    href: "/arena",
  },
  {
    venue: "GenLayer Agent Tank",
    outcome:
      "JobEscrow lifecycle with the gate approving the parties first. Venue closed, no win.",
    href: "/genlayer",
  },
  {
    venue: "Metropolis (Monad)",
    outcome:
      "Live gate against Envio's full history; the revoked fixture was the demo. Venue closed, no win.",
    href: "/field?chain=monad-testnet",
  },
  {
    venue: "Zecathon",
    outcome:
      "Zero-knowledge credential presentation for shielded payees. Venue closed, no win.",
    href: "/zcash",
  },
  {
    venue: "CROO Agent Store",
    outcome:
      "Provider selling the spend decision itself — still live, still serving.",
    href: "/croo",
  },
] as const;

export default function ProofsPage() {
  return (
    <main className="route-shell max-w-3xl">
      <div className="field-texture" aria-hidden />
      <div className="field-fog" aria-hidden />
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · Proofs</p>
        <Link
          href="/"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </header>

      <section className="mt-12">
        <h1 className="display text-4xl leading-[1.05] text-ink sm:text-5xl">
          Three artifacts. Verify each in five minutes.
        </h1>
        <p className="mt-5 max-w-xl font-serif text-lg italic leading-relaxed text-ink-soft">
          No venue logos, no claims you cannot check. Each artifact names how it
          stays fresh — and below, the ledger of what does not work, because
          that is what makes the rest believable.
        </p>
      </section>

      <Rule className="mt-14" />
      <ol className="mt-10 flex flex-col gap-12">
        {BENCH.map((b, i) => (
          <li key={b.name} className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-terra">
              Artifact {i + 1} · {b.name}
            </p>
            <p className="font-serif text-lg leading-relaxed text-ink">
              {b.claim}
            </p>
            <p className="font-mono text-[11px] leading-relaxed text-ink-quiet">
              {b.freshness}
            </p>
            {b.href ? (
              <p className="text-sm">
                <Link
                  href={b.href}
                  className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
                >
                  {b.action}
                </Link>
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <section className="mt-20">
        <p className="eyebrow">The honest ledger</p>
        <h2 className="display mt-4 text-3xl leading-tight text-ink">
          What does not work.
        </h2>
        <Rule className="mt-8" />
        <ol className="mt-8 flex flex-col gap-8">
          {LEDGER.map((l) => (
            <li key={l.what} className="flex flex-col gap-1.5">
              <p className="font-mono text-sm tabular text-loss">{l.what}</p>
              <p className="font-serif text-base leading-relaxed text-ink-soft">
                {l.state}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20 pb-8">
        <p className="eyebrow">Venue history</p>
        <Rule className="mt-6" />
        <ol className="mt-8 flex flex-col gap-8">
          {HISTORY.map((p) => (
            <li key={p.venue} className="flex flex-col gap-1.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                {p.venue}
              </p>
              <p className="font-serif text-base leading-relaxed text-ink-soft">
                {p.outcome}
              </p>
              <p className="text-sm">
                <Link
                  href={p.href}
                  className="text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                >
                  See the surface
                </Link>
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
