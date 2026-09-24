import Link from "next/link";
import type { Address } from "viem";
import { AddressDisplay } from "@/components/AddressDisplay";
import { CopyButton } from "@/components/CopyButton";
import { GateVerdict } from "@/components/GateVerdict";
import { Rule } from "@/components/Rule";
import { StyleguideInteractions } from "@/components/StyleguideInteractions";
import { addresses, network, readAgentId } from "@/lib/chain";

const SAMPLE_WALLET: Address = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

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

export default function StyleguidePage() {
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
              ✓ GO · ✗ STOP — the only verdict
            </span>
          </header>
          <Rule />
          <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            Every pre-payment decision renders through{" "}
            <code className="font-mono text-ink">GateVerdict</code>. Never
            invent capability-status labels as the decision — use ✓ GO / ✗ STOP
            via this primitive.
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
