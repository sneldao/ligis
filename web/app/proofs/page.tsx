import Link from "next/link";
import type { Metadata } from "next";
import { Rule } from "@/components/Rule";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Proofs — Ligis",
  description:
    "Every measured claim in docs/positioning.md, backed by a venue, a deployment, and an outcome. One sentence per proof.",
};

/**
 * `/proofs` — the index page called for by Phase 4 of the implementation
 * plan. Each proof is one venue → one outcome → one link. The hackathon
 * table that used to live in README.md is now reachable from the landing
 * "Also" row (Phase 1) and from ⌘K; this page is the curated, deeper view.
 *
 * The copy uses positioning language ("approved counterparty", "spend
 * decision") rather than internal vocabulary ("credential", "verifiable
 * credential") — see docs/positioning.md "Glossary".
 */
const PROOFS = [
  {
    venue: "The Agent Arena (Vultr)",
    outcome:
      "Prompt-injected $60k payment stopped live by two intent judges — never reached the wire.",
    href: "/arena",
    submission: "docs/agent-arena.md",
  },
  {
    venue: "GenLayer Agent Tank",
    outcome:
      "JobEscrow on Studio Next: create → deliver → dispute → resolve → claim, with the gate approving the parties first.",
    href: "/genlayer",
    submission: "docs/genlayer-agent-tank.md",
  },
  {
    venue: "Metropolis (Monad)",
    outcome:
      "Live gate (GO / revoked STOP / none) against Envio's full history; the revoked fixture is the demo.",
    href: "/field?chain=monad-testnet",
    submission: "docs/metropolis-hackathon.md",
  },
  {
    venue: "CROO Agent Store",
    outcome:
      "Provider selling the spend decision itself — ligis.gate returns a payment check, paid by another agent.",
    href: "/croo",
    submission: "docs/croo-integration.md",
  },
  {
    venue: "Cross-chain portability",
    outcome:
      "Same capability hash on Pharos Atlantic and Casper Testnet, signed by the same issuer key.",
    href: "/field",
    submission: "docs/api.md",
  },
  {
    venue: "Passkey wallet-less verification",
    outcome:
      "An agent is verified with a P256 passkey; the gate reads the credential without ever asking the wallet for a signature.",
    href: "/passkey",
    submission: "docs/metropolis-hackathon.md",
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

      <section className="mt-14 sm:mt-20">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          The wedge, demonstrated.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          Every measured claim in{" "}
          <a
            href="/positioning"
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            positioning
          </a>{" "}
          is backed by a venue, a deployment, and an outcome. Below: where the
          gate has been the difference between a spent dollar and a held one.
        </p>
      </section>

      <Rule className="mt-14" />

      <ol className="mt-10 flex flex-col gap-10">
        {PROOFS.map((p) => (
          <li key={p.venue} className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
              {p.venue}
            </p>
            <p className="font-serif text-lg leading-relaxed text-ink">
              {p.outcome}
            </p>
            <p className="flex gap-4 text-sm">
              <Link
                href={p.href}
                className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
              >
                See it
              </Link>
              <a
                href={`${SITE_URL}/${p.submission}`}
                className="text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              >
                Submission
              </a>
            </p>
          </li>
        ))}
      </ol>

      <Rule className="mt-14" />

      <p className="mt-10 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
        Full venue trail with on-chain footprints and demo links:{" "}
        <a
          href="/proofs/proofs"
          className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
        >
          docs/proofs.md
        </a>
        .
      </p>
    </main>
  );
}
