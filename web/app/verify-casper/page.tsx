import type { Address, Hex } from "viem";
import { capabilities, isCapable, readCredential } from "@/lib/chain";
import { isCapable as isCapableCasper, readCredential as readCredentialCasper, isCasperAddress } from "@/lib/chain-casper";
import { CASPER_TESTNET, getChain } from "@/lib/network";
import { isAddressLike, monthYear, truncateAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ subject?: string; capability?: string }>;

function withTimeout<T>(operation: Promise<T>, timeoutMs = 6_000): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("verification timed out")), timeoutMs);
    }),
  ]);
}

export const metadata = {
  title: "Verify · Ligis (Casper Testnet)",
  description: "Self-host verification for any Casper account. One URL, one hash, one decision.",
  robots: { index: true, follow: true },
};

const DEMO_SUBJECTS = [
  {
    label: "deployer account",
    value: "account-hash-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1",
  },
  {
    label: "issuer account",
    value: "account-hash-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37",
  },
];

const DEMO_CAPABILITIES = ["kyc.basic", "rwa.accredited", "data.premium", "agent.commerce.x402"];

export default async function VerifyCasperPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { subject: rawSubject, capability: rawCap } = await searchParams;
  const chain = getChain({ chain: CASPER_TESTNET.id });

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · casper testnet verify</p>
        <span className="font-mono tabular text-ink-quiet">{chain.name.toLowerCase()} · chain {chain.chainId}</span>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          Verify any Casper account.
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-ink-soft">
          One URL. One keccak256 capability hash. One on-chain read.
          The answer comes from Casper Testnet global state, not from a Ligis server.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">Demo</h2>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          Pick a subject and a capability. The page rebuilds the URL with the
          proper query params and re-renders against the live chain.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div className="rounded-sm border border-rule p-5">
            <p className="eyebrow">Subject</p>
            <ul className="mt-4 space-y-2 font-mono text-xs">
              {DEMO_SUBJECTS.map((s) => (
                <li key={s.value}>
                  <a
                    className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                    href={`/verify-casper?subject=${s.value}&capability=${rawCap ?? "kyc.basic"}`}
                  >
                    {s.label}
                  </a>
                  <p className="mt-1 pl-2 text-[11px] text-ink-quiet">{truncateAddress(s.value, 12, 6)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-sm border border-rule p-5">
            <p className="eyebrow">Capability</p>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
              {DEMO_CAPABILITIES.map((c) => (
                <li key={c}>
                  <a
                    className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                    href={`/verify-casper?subject=${rawSubject ?? DEMO_SUBJECTS[0].value}&capability=${c}`}
                  >
                    {c}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {rawSubject && rawCap ? (
        <section className="mt-16">
          <h2 className="eyebrow">Result</h2>
          <div className="mt-6">
            <Result subject={rawSubject} capability={rawCap} />
          </div>
        </section>
      ) : (
        <section className="mt-16">
          <h2 className="eyebrow">Result</h2>
          <p className="mt-4 font-serif text-base italic text-ink-quiet">
            Click a subject and capability above to run the check.
          </p>
        </section>
      )}

      <section className="mt-16">
        <h2 className="eyebrow">API</h2>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          The same path is exposed as a JSON endpoint for programmatic checks.
          Returns <code className="font-mono text-ink">{`{capable, capabilityHash, latest}`}</code>.
        </p>
        <pre className="mt-4 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
{`GET /verify-casper?subject=account-hash-...&capability=kyc.basic`}
        </pre>
      </section>

      <footer className="route-footer mt-16 text-xs text-ink-quiet">
        <a href="/" className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra">← Index</a>
        <a href={chain.explorerUrl} target="_blank" rel="noreferrer" className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra">cspr.live ↗</a>
      </footer>
    </main>
  );
}

async function Result({ subject, capability }: { subject: string; capability: string }) {
  if (!isCasperAddress(subject)) {
    return (
      <p className="font-serif text-base text-revoke">
        Invalid subject. Expected <code className="font-mono">account-hash-...</code> format.
      </p>
    );
  }
  const cap = capabilities.find((c) => c.id === capability || c.hash.toLowerCase() === capability.toLowerCase());
  if (!cap) {
    return (
      <p className="font-serif text-base text-revoke">
        Unknown capability <code className="font-mono">{capability}</code>. Available: {capabilities.map((c) => c.id).join(", ")}.
      </p>
    );
  }

  let capable: boolean;
  try {
    capable = await withTimeout(isCapableCasper(subject, cap.hash as Hex));
  } catch {
    return (
      <p className="font-serif text-base text-revoke">
        Live verification is temporarily unavailable. Try cspr.live directly.
      </p>
    );
  }
  const view = capable
    ? await withTimeout(readCredentialCasper(subject, cap.hash as Hex)).catch(() => null)
    : null;

  return (
    <div className="rounded-sm border border-rule p-6">
      <p className="font-mono text-sm tabular text-ink-soft">
        subject: {truncateAddress(subject as Address, 8, 8)}
      </p>
      <p className="mt-1 font-mono text-sm tabular text-ink-soft">
        capability: {cap.id}
      </p>
      <p className="mt-4 font-display text-3xl">
        {capable ? (
          <span className="text-sage">✓ Capable</span>
        ) : (
          <span className="text-revoke">✗ Not capable</span>
        )}
      </p>
      {view?.issuer ? (
        <p className="mt-3 font-serif text-base leading-relaxed text-ink-soft">
          Issued by <code className="font-mono text-ink">{truncateAddress(view.issuer, 6, 4)}</code>
          {view.expiresAt && view.expiresAt > 0n
            ? `, expires ${monthYear(view.expiresAt)}`
            : ", no expiry"}
          .
        </p>
      ) : null}
      <p className="mt-6 text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        Source: Casper Testnet global state via <code className="font-mono">state_get_dictionary_item</code>. On-chain. Not a Ligis server.
      </p>
    </div>
  );
}
