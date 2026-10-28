import Link from "next/link";
import {
  DEMO_CAPABILITY,
  DEMO_PAYEE,
  DEMO_REVOKED_PAYEE,
} from "@ligis/circuits-zcash/demo";
import { ZcashDemo } from "@/components/ZcashDemo";
import { Term } from "@/components/Term";
import { zkDemoEnabled } from "@/lib/zk-demo";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shielded Zcash, gated",
  description:
    "A guided demo: an agent pays a shielded Zcash address only after the payee proves, in zero knowledge, that it holds a valid credential. Replays and revoked credentials are stopped.",
  robots: { index: true, follow: true },
};

export default function ZcashPage() {
  const live = zkDemoEnabled(process.env);
  return (
    <main className="route-shell max-w-3xl">
      <div className="field-texture" aria-hidden />
      <div className="field-fog" aria-hidden />
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · Zcash</p>
        <Link
          href="/"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          Pay a shielded stranger, safely.
        </h1>
        <p className="mt-5 max-w-xl font-serif text-lg leading-relaxed text-ink-soft">
          Your agent is about to release ZEC to a{" "}
          <Term term="shielded">shielded address</Term>. Nobody can see who is
          behind it. Ligis lets the payee prove it is credentialed for the job
          with a <Term term="zkProof">zero-knowledge proof</Term>, so the agent
          pays only a vetted payee and nobody learns who it is.
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          4 steps · about a minute · demo credentials, no real funds
        </p>
      </section>

      <ZcashDemo
        live={live}
        payee={DEMO_PAYEE}
        revokedPayee={DEMO_REVOKED_PAYEE}
        capability={DEMO_CAPABILITY}
      />

      <section className="mt-20">
        <h2 className="eyebrow">How it works</h2>
        <ol className="mt-4 max-w-xl list-decimal space-y-3 pl-5 font-serif text-base leading-relaxed text-ink-soft">
          <li>
            Issuers record credentials publicly on a{" "}
            <code className="font-mono text-sm">CredentialRegistry</code>{" "}
            (accountable, revocable). Ligis publishes a{" "}
            <Term term="registryRoot">registry fingerprint</Term> of every valid
            one.
          </li>
          <li>
            The payee proves, in zero knowledge, that its credential is in that
            fingerprint, is for this permission, hasn&rsquo;t expired, and is{" "}
            <Term term="payeeBinding">bound to its own address</Term>.
          </li>
          <li>
            The gate checks the proof and records its{" "}
            <Term term="nullifier">one-time tag</Term>, so it can&rsquo;t be
            replayed. Revoked credentials drop out of the fingerprint.
          </li>
        </ol>
        <p className="mt-6 font-serif text-sm leading-relaxed text-ink-quiet">
          Circuit: Noir + UltraHonk (Barretenberg), Poseidon Merkle membership
          over a depth-16 tree. API:{" "}
          <code className="font-mono">POST /api/gate</code> with{" "}
          <code className="font-mono">zkProof</code>,{" "}
          <code className="font-mono">GET /api/zk/root</code>. Run it from a
          terminal: <code className="font-mono">pnpm demo:zcash-zk</code>.
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
          zcash testnet · {live ? "live proving on" : "live proving off"}
        </span>
      </footer>
    </main>
  );
}
