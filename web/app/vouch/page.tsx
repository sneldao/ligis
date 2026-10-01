import Link from "next/link";
import { ChainBadge } from "@/components/ChainBadge";
import { Rule } from "@/components/Rule";
import { isCasperChain } from "@/lib/chain-router";
import { getChain } from "@/lib/network";
import { vouchIssuer } from "@/lib/vouch";
import { DEMO_GATE_SAMPLES } from "@/lib/demo-subjects";
import { VouchDesk } from "./VouchDesk";

export const metadata = {
  title: "Vouch — Ligis",
  description:
    "The supply side of the gate: issue a credential to an agent and the next read answers GO; pull it back and the read answers STOP.",
};

export const dynamic = "force-dynamic";

export default async function VouchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const chain = getChain(await searchParams);
  const casper = isCasperChain(chain);
  const issuer = casper ? null : vouchIssuer();
  const defaultSubject =
    issuer ?? DEMO_GATE_SAMPLES[chain.id]?.[0]?.subject ?? "";

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · Vouch</p>
        <div className="flex items-baseline gap-6">
          <ChainBadge chain={chain} />
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← Home
          </Link>
        </div>
      </header>

      <section className="mt-14 sm:mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          Vouch for an agent.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          An issuer is whoever says yes. The desk below signs a credential with
          the demo issuer&rsquo;s key — the same steward wallet that runs the
          loop — and the{" "}
          <Link
            href="/gate"
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            gate
          </Link>{" "}
          answers on the next read. In production the issuer is your own key,
          your own policy; the registry does not care which.
        </p>
      </section>

      <section className="mt-14 sm:mt-16">
        {casper ? (
          <p className="font-serif text-base italic text-ink-quiet">
            The issuer desk is wired for the EVM registries —{" "}
            <a
              href="/vouch?chain=monad-testnet"
              className="not-italic text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              vouch on Monad
            </a>{" "}
            or{" "}
            <a
              href="/vouch?chain=pharos-atlantic"
              className="not-italic text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Pharos
            </a>
            . On Casper, issuance runs through the steward loop.
          </p>
        ) : (
          <VouchDesk
            chainId={chain.id}
            issuer={issuer}
            defaultSubject={defaultSubject}
          />
        )}
      </section>

      <section className="mt-16 sm:mt-20">
        <p className="eyebrow">The audit trail</p>
        <Rule className="mt-4" />
        <p className="mt-5 max-w-prose font-serif text-sm leading-relaxed text-ink-soft sm:text-base">
          Everything the desk writes lands on the public ledger —{" "}
          <Link
            href={`/issuers?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            issuers
          </Link>{" "}
          lists who vouched, when, and for what. Revocation is a write too:
          pulling a credential back is itself on-chain evidence that the gate
          moved.
        </p>
      </section>

      <footer className="route-footer mt-20 text-xs text-ink-quiet sm:mt-32">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
        <span className="font-mono tabular">
          {chain.name.toLowerCase()}
          {chain.chainId
            ? ` · chain ${chain.chainId}`
            : ` · ${chain.chainName}`}
        </span>
      </footer>
    </main>
  );
}
