import Link from "next/link";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { StewardRunner } from "@/components/StewardRunner";
import { network } from "@/lib/chain";

const DEFAULT_GOAL =
  "I am a Pharos agent. I need to participate in escrow-backed commerce and swap between approved venues. Figure out what credentials I need and make sure I have them.";

const SELF_HOSTED = `# 0G wallet (one-time, see docs/setup.md)
source .env.d/zerog.env
PRIVATE_KEY=0x... bash scripts/setup-zerog.ts

# Then run the loop against any goal
PRIVATE_KEY=0x... ligis agent run \\
  --goal "Operate as a Pharos agent that participates in escrow-backed commerce."`;

export const metadata = {
  title: "The Steward — Ligis",
  description:
    "An agent that doesn't know who it is yet. Watch it mint its own identity, reason about what it needs, earn credentials, and record its journey — all autonomously.",
};

export default function StewardPage() {
  return (
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · steward 00</p>
        <Link
          href="/"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Index
        </Link>
      </header>

      <section className="mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          An agent that
          <br />
          doesn&rsquo;t know
          <br />
          who it is yet.
        </h1>
        <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          The Trust Steward arrives with nothing but a goal. No identity token,
          no credentials, no proof of what it can do. Over the next few seconds
          it mints its own agent ID, asks 0G Compute what capabilities the goal
          requires, checks the credential registry, self-issues whatever is
          missing, and anchors a tamper-proof manifest of every step into 0G
          Storage. By the end it knows who it is, what it can do, and can prove
          both. This is the autonomous loop.
        </p>
        <div
          className="mt-8 flex items-start gap-4 bg-paper-deep px-5 py-4"
          style={{ borderLeft: "3px solid #B85D3E" }}
        >
          <span className="mt-0.5 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-terra">
            live or simulated
          </span>
          <p className="font-serif text-sm leading-relaxed text-ink-soft">
            The loop supports two modes: <strong>simulated</strong> (default —
            no on-chain writes, no wallet needed) and <strong>live</strong>{" "}
            (toggle on to run real <span className="font-mono text-ink">isCapableMulti</span>{" "}
            reads, self-issue credentials via signed EIP-712 transactions, and
            anchor an evidence manifest on-chain via{" "}
            <span className="font-mono text-ink">setTokenURI</span>). Live mode
            requires a funded wallet key on the server.
          </p>
        </div>
      </section>

      <section className="mt-24">
        <StewardRunner defaultGoal={DEFAULT_GOAL} />
      </section>

      <section className="mt-32">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Or run it yourself</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">cli · authentic</p>
        </header>
        <Rule className="mt-4" />
        <p className="mt-8 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          The CLI runs the same loop against your own keys. Nothing is shared
          with this site. The output is identical JSON to the stream above.
        </p>
        <div className="mt-8">
          <Snippet code={SELF_HOSTED} lang="sh" />
        </div>
      </section>

      <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Return to the index
        </Link>
        <span className="font-mono tabular">
          {network.name.toLowerCase()} · chain {network.chainId}
        </span>
      </footer>
    </main>
  );
}
