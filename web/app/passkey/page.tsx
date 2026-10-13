import Link from "next/link";
import { ChainBadge } from "@/components/ChainBadge";
import { PasskeyCeremony } from "./PasskeyCeremony";
import { MONAD_TESTNET } from "@/lib/network";

export const metadata = {
  title: "Passkey operator onboarding · Ligis",
  description:
    "Seedless sign-in is separate from issuer authority. Explore a guarded passkey operator workflow and ask the full payment risk gate.",
};
export const dynamic = "force-dynamic";

export default function PasskeyPage() {
  return (
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · Passkey</p>
        <div className="flex items-baseline gap-6">
          <ChainBadge chain={MONAD_TESTNET} />
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:decoration-terra"
          >
            ← Home
          </Link>
        </div>
      </header>
      <section className="mt-14 max-w-3xl sm:mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          A passkey signs.
          <br />
          An operator admits.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          Seedless sign-in can create an embedded agent wallet. It does not
          prove KYC, accreditation or commerce trust. Only the owner can admit a
          P-256 key to the shared issuer desk. Every admitted key shares that
          desk&apos;s authority.
        </p>
        <details className="group mt-6 border-y border-rule">
          <summary className="cursor-pointer py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
            Verification and readiness
          </summary>
          <div className="space-y-4 border-t border-rule py-5 font-serif text-sm leading-relaxed text-ink-soft">
            <p>
              The login passkey authenticates the provider account. A secp256k1
              embedded-wallet key signs the transaction. A separate admitted
              P-256 passkey signs the issuance or revocation digest, which the
              issuer verifies through Monad&apos;s 0x0100 precompile.
            </p>
            <p>
              The previous server steward paid gas. It was a relay, not a
              passkey wallet, paymaster or ERC-4337 account. This page never
              falls back to that funded relay.
            </p>
            <p>
              Local source hardening does not change deployed bytecode. Live
              writes stay disabled pending an authorized hardened issuer
              deployment and trust cutover. Privy sponsorship configuration and
              hackathon eligibility are not verified. WebAuthn alone does not
              establish Mera eligibility.
            </p>
            <p>
              The local fixture uses a real browser assertion and mocked
              account, operator admission, sponsorship and receipts. It is not
              production-ready or live chain proof.
            </p>
          </div>
        </details>
      </section>
      <section className="mt-12 sm:mt-16">
        <PasskeyCeremony />
      </section>
      <footer className="route-footer mt-20 text-xs text-ink-quiet sm:mt-32">
        <Link
          href="/gate"
          className="text-ink-soft underline decoration-rule underline-offset-4 hover:decoration-terra"
        >
          Full payment risk gate →
        </Link>
        <span className="font-mono tabular">
          {MONAD_TESTNET.name.toLowerCase()} · chain {MONAD_TESTNET.chainId}
        </span>
      </footer>
    </main>
  );
}
