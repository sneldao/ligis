import Link from "next/link";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { getChain } from "@/lib/network";

export const metadata = {
  title: "CROO · Ligis",
  description:
    "Ask Ligis for a counterparty risk report on CROO before your agent pays — score, verdict, and reasons.",
};

const CROO_SNIPPET = [
  'import { LigisCrooRequester } from "@ligis/croo-adapter";',
  "",
  "// Before your agent pays a stranger, ask Ligis if it's safe.",
  'const ligis = new LigisCrooRequester({ sdkKey: "croo_sk_..." });',
  "",
  'const report = await ligis.request("ligis.risk", {',
  '  subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",',
  '  capabilities: ["kyc.basic", "agent.commerce.escrow"],',
  "  minTtlSeconds: 86400, // require 24h remaining",
  "});",
  "",
  'if (report.overallVerdict === "fail") {',
  "  // Hard stop. The counterparty can't prove it's authorized.",
  '  throw new Error("Counterparty failed risk check: " + report.summary);',
  "}",
  "",
  "// report.riskScore      -> 0-100 (higher is safer)",
  "// report.breakdown      -> { capabilityWeighted, ttlHealth, ... }",
  "// report.signals        -> [{ code, detail }, ...]",
].join("\n");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CrooPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const chain = getChain(await searchParams);
  const home = `/?chain=${chain.id}`;

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · CROO Agent Store</p>
        <Link
          href={home}
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          Spend cents before you send thousands.
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-ink-soft">
          Ask Ligis for a counterparty risk report before your agent pays. It
          returns a score, verdict, and the reasons behind it — via CROO and
          x402.
        </p>
      </section>

      <section className="mt-12">
        <div className="grid gap-4 border-y border-rule py-5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet sm:grid-cols-3 sm:gap-8">
          <span>
            <b className="mr-2 font-mono font-normal text-terra">01</b>find a
            counterparty
          </span>
          <span>
            <b className="mr-2 font-mono font-normal text-terra">02</b>check its
            credentials
          </span>
          <span>
            <b className="mr-2 font-mono font-normal text-terra">03</b>pay or
            stop
          </span>
        </div>
      </section>

      <section className="mt-14">
        <p className="eyebrow">Services</p>
        <Rule className="mt-3" />
        <p className="mt-5 font-serif text-base leading-relaxed text-ink-soft">
          <code className="font-mono text-ink">ligis.risk</code> $0.75 ·{" "}
          <code className="font-mono text-ink">ligis.verify</code> $0.50 ·{" "}
          <code className="font-mono text-ink">ligis.issue</code> $2.00 ·{" "}
          <code className="font-mono text-ink">ligis.gate</code> $1.00 ·{" "}
          <code className="font-mono text-ink">ligis.qualify</code> $2.50
        </p>
      </section>

      <section className="mt-14">
        <p className="eyebrow">Integration</p>
        <Rule className="mt-3" />
        <div className="mt-6">
          <Snippet code={CROO_SNIPPET} lang="ts" />
        </div>
        <p className="mt-5 max-w-2xl font-serif text-sm italic leading-relaxed text-ink-quiet">
          Critical capabilities count more heavily; short-lived or newly issued
          credentials lower confidence. A critical credential below the required
          TTL is a hard stop.
        </p>
      </section>

      <footer className="route-footer mt-20 text-xs text-ink-quiet">
        <Link
          href={home}
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
        <a
          href="https://github.com/sneldao/ligis/tree/main/packages/croo-adapter"
          target="_blank"
          rel="noreferrer"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          croo-adapter ↗
        </a>
      </footer>
    </main>
  );
}
