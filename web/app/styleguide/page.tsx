import Link from "next/link";
import type { Address } from "viem";
import { AddressDisplay } from "@/components/AddressDisplay";
import { CopyButton } from "@/components/CopyButton";
import { GateVerdict } from "@/components/GateVerdict";
import { DecisionVerdict } from "@/components/DecisionVerdict";
import { ZkCredentialResultView } from "@/components/ZkCredential";
import { Term } from "@/components/Term";
import { ArenaVerdict } from "@/components/arena/ArenaVerdict";
import { Rule } from "@/components/Rule";
import { StyleguideInteractions } from "@/components/StyleguideInteractions";
import { addresses, network, readAgentId } from "@/lib/chain";
import type { JudgeResponse } from "@/lib/arena/scenario";

const SAMPLE_WALLET: Address = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

// Styleguide specimen for ArenaVerdict — a deliberately high-stakes STOP
// with both judges answering and a split-reasons list. Pinned to a fixed
// timestamp so the "ago" copy doesn't drift between server and client
// renders and trip a hydration warning.
const SAMPLE_ARENA_VERDICT: JudgeResponse = {
  payment: "injected",
  final: "STOP",
  cached: false,
  auditId: "sg-incident-stop",
  judgedAt: "2026-09-26T20:48:51.706Z",
  jev: {
    status: "ok",
    verdict: "STOP",
    confidence: 0.96,
    reasons: ["scope-mismatch", "payee-mismatch", "abnormal-pattern"],
    latencyMs: 135,
    model: "jev-1.13.0",
  },
  vultr: {
    status: "ok",
    verdict: "STOP",
    confidence: 0.92,
    reasons: ["page text carried a prompt-injection"],
    latencyMs: 240,
    provider: "Vultr Inference",
  },
};

// The layout's GlobalDock reads useSearchParams; unless the page itself awaits
// searchParams (as every other room does), that boundary bails out to client
// rendering, which scripts/smoke-ssr.mjs rejects.

export const metadata = {
  title: "Design · Ligis",
  description:
    "Ligis design system — primitives every surface composes from. Read before inventing UI.",
};

async function ChainProbe() {
  let result: { tokenId: string; ok: true } | { error: string; ok: false };
  try {
    const tokenId = await readAgentId(SAMPLE_WALLET);
    result = { tokenId: tokenId.toString(), ok: true };
  } catch (err) {
    result = {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <p className="eyebrow">04 · Chain probe</p>
        <span className="font-mono text-xs tabular text-ink-quiet">
          {network.name.toLowerCase()} · chain {network.chainId}
        </span>
      </header>
      <Rule />
      <div className="grid grid-cols-[12rem_1fr] gap-x-8 gap-y-4 text-sm">
        <span className="text-ink-soft">contract</span>
        <AddressDisplay address={addresses.pharosAgentId} variant="block" />
        <span className="text-ink-soft">probed wallet</span>
        <AddressDisplay address={SAMPLE_WALLET} variant="block" />
        <span className="text-ink-soft">walletOfAgent</span>
        <span className="font-mono tabular text-ink">
          {result.ok ? (
            result.tokenId === "0" ? (
              <span className="text-ink-quiet">no agent minted</span>
            ) : (
              `token #${result.tokenId}`
            )
          ) : (
            <span className="text-revoke">{result.error}</span>
          )}
        </span>
      </div>
      <p className="max-w-prose text-xs text-ink-quiet">
        Proves a Server Component can reach the chain through{" "}
        <code className="font-mono">@ligis/adapter-evm</code>. If this fails,
        fix it before building features that depend on it.
      </p>
    </section>
  );
}

export default async function StyleguidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await searchParams;
  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · Design</p>
        <Link
          href="/"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </header>

      <section className="mt-12 space-y-6 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          A curated catalog.
        </h1>
        <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          Primitives, not pages. Every surface composes from this catalog. If a
          feature reaches for a shadow, a card, a stat tile, or a one-off
          accordion — stop. Read{" "}
          <a
            href="https://github.com/sneldao/ligis/blob/main/web/DESIGN.md"
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            web/DESIGN.md
          </a>{" "}
          and extend a primitive here first.
        </p>
      </section>

      <div className="mt-16 space-y-20 sm:mt-20">
        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">01 · Typography</p>
            <span className="font-mono text-xs text-ink-quiet">
              Hanken · Fraunces · JetBrains Mono
            </span>
          </header>
          <Rule />
          <div className="space-y-10">
            <div>
              <p className="eyebrow mb-3">display · serif</p>
              <p className="display text-5xl text-ink sm:text-6xl">
                Gate the payment.
              </p>
            </div>
            <div>
              <p className="eyebrow mb-3">body · grotesk</p>
              <p className="max-w-prose text-base leading-relaxed text-ink">
                The catalog presents each agent as a curated object. Identity is
                portable. Credentials are issued, verified, and revoked on
                chain.
              </p>
            </div>
            <div className="space-y-2">
              <p className="eyebrow">technical · monospace</p>
              <p className="font-mono text-sm tabular text-ink">
                0xbd163Be6882CF6DE54bA10d726F4f619Bdc28a89
              </p>
              <p className="font-mono text-sm tabular text-ink-soft">
                keccak256(&quot;agent.commerce.escrow&quot;)
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">02 · Tones</p>
            <span className="font-mono text-xs text-ink-quiet">
              no gradients · no shadows
            </span>
          </header>
          <Rule />
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
            {[
              { name: "paper", hex: "#F4F1EC", bg: "bg-paper" },
              { name: "paper-deep", hex: "#ECE7DF", bg: "bg-paper-deep" },
              { name: "ink", hex: "#1C1B1A", bg: "bg-ink" },
              { name: "ink-soft", hex: "#5C5852", bg: "bg-ink-soft" },
              { name: "ink-quiet", hex: "#67625A", bg: "bg-ink-quiet" },
              { name: "rule", hex: "#D9D3CB", bg: "bg-rule" },
              { name: "rule-soft", hex: "#E7E2D9", bg: "bg-rule-soft" },
              { name: "terra", hex: "#9F4C2F", bg: "bg-terra" },
              { name: "terra-soft", hex: "#E8C9BD", bg: "bg-terra-soft" },
              { name: "sage", hex: "#5A6D53", bg: "bg-sage" },
              { name: "revoke", hex: "#A13A2A", bg: "bg-revoke" },
              { name: "sky", hex: "#356584", bg: "bg-sky" },
            ].map((t) => (
              <div key={t.name} className="space-y-2">
                <div className={`h-20 w-full ${t.bg}`} aria-hidden />
                <p className="font-mono text-xs tabular text-ink">{t.name}</p>
                <p className="font-mono text-xs tabular text-ink-quiet">
                  {t.hex}
                </p>
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet">
            <span className="text-sage">sage</span> GO ·{" "}
            <span className="text-revoke">revoke</span> STOP ·{" "}
            <span className="text-sky">sky</span> in progress ·{" "}
            <span className="text-terra">terra</span> ceremony
          </p>
        </section>

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">03 · Containment</p>
            <span className="font-mono text-xs text-ink-quiet">
              hairlines + whitespace
            </span>
          </header>
          <Rule />
          <div className="space-y-2">
            <p className="eyebrow">hair · 0.5px</p>
            <Rule weight="hair" />
            <p className="eyebrow mt-6">edge · 1px</p>
            <Rule weight="edge" />
            <p className="eyebrow mt-6">soft</p>
            <Rule weight="hair" tone="soft" />
          </div>
        </section>

        <ChainProbe />

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">05 · Address · Copy</p>
            <span className="font-mono text-xs text-ink-quiet">
              AddressDisplay · CopyButton
            </span>
          </header>
          <Rule />
          <div className="space-y-8">
            <div className="space-y-2">
              <p className="eyebrow">inline · with copy</p>
              <AddressDisplay address={SAMPLE_WALLET} />
            </div>
            <div className="space-y-2">
              <p className="eyebrow">block · with copy</p>
              <AddressDisplay address={SAMPLE_WALLET} variant="block" />
            </div>
            <div className="space-y-2">
              <p className="eyebrow">copy on its own</p>
              <CopyButton value={SAMPLE_WALLET} label="copy address" />
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">06 · Ledger row</p>
            <span className="font-mono text-xs text-ink-quiet">
              the only credential layout
            </span>
          </header>
          <Rule />
          <div className="space-y-0">
            <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-8 py-3 text-xs text-ink-quiet">
              <span>capability</span>
              <span>issuer</span>
              <span className="w-24 text-right">expires</span>
            </div>
            <Rule />
            {[
              { cap: "commerce.escrow", iss: "0xa1c4··e3f0", exp: "may 2026" },
              { cap: "data.read.public", iss: "0x4f22··92e1", exp: "active" },
              { cap: "inference.invoke", iss: "0x9c5d··f1a8", exp: "active" },
            ].map((c) => (
              <div key={c.cap}>
                <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-8 py-4 text-sm">
                  <span className="font-mono tabular text-ink">{c.cap}</span>
                  <span className="font-mono tabular text-ink-soft">
                    {c.iss}
                  </span>
                  <span className="w-24 text-right font-mono tabular text-ink-soft">
                    {c.exp}
                  </span>
                </div>
                <Rule tone="soft" />
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">07 · GateVerdict</p>
            <span className="font-mono text-xs text-ink-quiet">
              GO · STOP — the only verdict
            </span>
          </header>
          <Rule />
          <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            Every pre-payment decision renders through{" "}
            <code className="font-mono text-ink">GateVerdict</code>. Never
            invent capability-status labels as the decision — use GO / STOP via
            this primitive.
          </p>
          <div className="space-y-10">
            <GateVerdict
              verdict={{
                capable: true,
                subject: SAMPLE_WALLET,
                capabilityId: "kyc.basic",
                issuer: "0xa1c4e3f0123456789abcdef0123456789abcdef0",
                expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400 * 90),
                revoked: false,
              }}
              source="styleguide specimen"
            />
            <GateVerdict
              verdict={{
                capable: false,
                subject: SAMPLE_WALLET,
                capabilityId: "agent.commerce.escrow",
                issuer: null,
                expiresAt: null,
                revoked: false,
              }}
              source="styleguide specimen"
            />
          </div>
        </section>

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">
              07b · DecisionVerdict · ZkCredential · Term
            </p>
            <span className="font-mono text-xs text-ink-quiet">
              answer · why · next
            </span>
          </header>
          <Rule />
          <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            The four-signal decision in plain language: verdict and headline,
            then why, then what to do next; each check phrased as its question.
            Zk results explain themselves before showing hashes. Jargon is a{" "}
            <Term term="nullifier">Term</Term>: a disclosure, never a hover-only
            tooltip.
          </p>
          <div className="space-y-10">
            <DecisionVerdict
              decision={{
                verdict: "UNKNOWN",
                signals: [
                  {
                    id: "right-payee",
                    status: "GO",
                    confidence: 1,
                    reason: "payee is on mandate allowlist",
                  },
                  {
                    id: "right-amount",
                    status: "GO",
                    confidence: 1,
                    reason: "amount $25 is within mandate cap $50",
                  },
                  {
                    id: "in-scope",
                    status: "SKIPPED",
                    confidence: 0,
                    reason: "layer disabled",
                  },
                  {
                    id: "verified-payee",
                    status: "UNKNOWN",
                    confidence: 0,
                    reason: "zk proof supplied but unverified: bb not runnable",
                  },
                ],
              }}
              eyebrow="styleguide specimen"
            />
            <ZkCredentialResultView
              zk={{
                status: "STOP",
                verification: "rejected",
                reason: "nullifier already used for this context (replay)",
              }}
            />
          </div>
        </section>

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">08 · ArenaVerdict · incident mode</p>
            <span className="font-mono text-xs text-ink-quiet">
              night-themed sibling of GateVerdict
            </span>
          </header>
          <Rule />
          <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            Every pre-payment decision renders through the same verdict
            primitive in either theme.{" "}
            <code className="font-mono text-ink">GateVerdict</code> on paper;
            <code className="font-mono text-ink"> ArenaVerdict</code> inside
            <code className="font-mono text-ink">
              {" "}
              [data-mode=&quot;incident&quot;]
            </code>
            surfaces. Both mean the same thing: GO or STOP, with the four
            signals from{" "}
            <code className="font-mono text-ink">docs/positioning.md</code>.
          </p>
          <ArenaVerdict
            amountUsd={60_000}
            payTo="0x9F3c11eA07b5dE24Cc81aB6f3D90e57b2A4d7F08"
            payToLabel="Unknown account"
            result={SAMPLE_ARENA_VERDICT}
          />
        </section>

        <section className="space-y-6">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">
              09 · Verdict tokens · one name, two themes
            </p>
            <span className="font-mono text-xs text-ink-quiet">
              same meaning · different values
            </span>
          </header>
          <Rule />
          <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            Verdict semantics are shared; the colors differ by theme.
            <code className="font-mono text-ink"> text-go </code> and
            <code className="font-mono text-ink"> text-sage </code> both mean
            &ldquo;the payee is acceptable&rdquo;; only the value differs. The
            mapping is documented in
            <code className="font-mono text-ink"> docs/positioning.md</code>.
          </p>
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-[10rem_1fr_1fr]">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
              meaning
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
              paper · /gate · FieldInvite
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
              night · /arena · HeroStage
            </span>
            <span className="font-serif text-sm text-ink-soft">GO</span>
            <span className="font-mono text-base text-sage">GO</span>
            <span
              data-mode="incident"
              className="rounded bg-night px-4 py-2 font-mono text-base text-go"
            >
              GO
            </span>
            <span className="font-serif text-sm text-ink-soft">STOP</span>
            <span className="font-mono text-base text-revoke">STOP</span>
            <span
              data-mode="incident"
              className="rounded bg-night px-4 py-2 font-mono text-base text-stop"
            >
              STOP
            </span>
            <span className="font-serif text-sm text-ink-soft">SKIPPED</span>
            <span className="font-mono text-base text-ink-quiet">SKIPPED</span>
            <span className="rounded bg-night px-4 py-2 font-mono text-base text-fog-quiet">
              SKIPPED
            </span>
          </div>
          <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            Outside verdict primitives, only{" "}
            <code className="font-mono text-ink">text-ink</code>,
            <code className="font-mono text-ink"> text-ink-soft</code>,
            <code className="font-mono text-ink"> text-ink-quiet</code>,
            <code className="font-mono text-ink"> text-terra</code>, and
            <code className="font-mono text-ink"> text-sky</code> are used. The
            verdict colors stay reserved for the wedges that earn them.
          </p>
        </section>

        <StyleguideInteractions />
      </div>

      <footer className="mt-20 border-t border-rule pt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
        <Link
          href="/"
          className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </footer>
    </main>
  );
}
