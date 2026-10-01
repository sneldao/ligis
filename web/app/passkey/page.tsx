import Link from "next/link";
import { ChainBadge } from "@/components/ChainBadge";
import { Snippet } from "@/components/Snippet";
import { PasskeyCeremony } from "./PasskeyCeremony";
import { MONAD_TESTNET } from "@/lib/network";

export const metadata = {
  title: "Passkey — Ligis",
  description:
    "A passkey as a credential issuer on Monad. Touch ID signs; the on-chain P256 precompile verifies; the registry mints the credential. No seed phrase, no env file.",
};

export const dynamic = "force-dynamic";

const CLI = `# Same ceremony from the CLI (Node-generated P-256 key,
# byte-identical calldata to what this page produces):
set -a && source .env.d/deployer.env && set +a
export PRIVATE_KEY=$PHAROS_DEPLOYER_KEY
pnpm demo:monad-passkey`;

export default function PasskeyPage() {
  return (
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · Passkey</p>
        <div className="flex items-baseline gap-6">
          <ChainBadge chain={MONAD_TESTNET} />
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← Home
          </Link>
        </div>
      </header>

      <section className="mt-14 max-w-3xl sm:mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          A fingerprint
          <br />
          is the issuer.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          Your passkey signs a credential digest; Monad&rsquo;s native P256
          precompile verifies it on-chain; the registry mints the credential.
          The issuer is hardware — there is no key to leak.
        </p>
        <details className="group mt-6 border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
            <span className="group-open:hidden">How verification works +</span>
            <span className="hidden group-open:inline">
              Close verification details −
            </span>
          </summary>
          <ol className="grid grid-cols-1 divide-y divide-rule border-t border-rule sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <li className="space-y-2 py-4 sm:pr-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                01 · enroll
              </p>
              <p className="font-serif text-sm leading-relaxed text-ink-soft">
                <span className="font-mono text-ink">
                  navigator.credentials.create()
                </span>{" "}
                produces a P-256 keypair. Only the public key goes on-chain.
              </p>
            </li>
            <li className="space-y-2 py-4 sm:px-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                02 · assert
              </p>
              <p className="font-serif text-sm leading-relaxed text-ink-soft">
                The registry&rsquo;s EIP-712 digest becomes the WebAuthn
                challenge. Your authenticator signs{" "}
                <span className="font-mono text-ink">
                  authData ‖ sha256(clientDataJSON)
                </span>
                .
              </p>
            </li>
            <li className="space-y-2 py-4 sm:pl-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                03 · verify
              </p>
              <p className="font-serif text-sm leading-relaxed text-ink-soft">
                <span className="font-mono text-ink">PasskeyIssuer</span> calls
                the <span className="font-mono text-ink">0x0100</span>{" "}
                precompile (EIP-7951) — one on-chain read, no oracle, no
                signature service.
              </p>
            </li>
          </ol>
        </details>
      </section>

      <section className="mt-12 sm:mt-16">
        <PasskeyCeremony />
      </section>

      <section className="mt-12 max-w-3xl sm:mt-16">
        <details className="group border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
            <span className="group-open:hidden">
              Run the same ceremony locally +
            </span>
            <span className="hidden group-open:inline">
              Hide CLI instructions −
            </span>
          </summary>
          <div className="border-t border-rule-soft py-5">
            <Snippet code={CLI} lang="sh" />
          </div>
        </details>
      </section>

      <footer className="route-footer mt-20 text-xs text-ink-quiet sm:mt-32">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
        <span className="font-mono tabular">
          {MONAD_TESTNET.name.toLowerCase()} · chain {MONAD_TESTNET.chainId}
        </span>
      </footer>
    </main>
  );
}
