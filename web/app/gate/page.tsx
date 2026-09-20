import { CHAINS, getChain, type ChainNetwork } from "@/lib/network";
import { capabilities } from "@/lib/chain";
import { isCasperChain } from "@/lib/chain-router";
import { verifySubject } from "@/lib/verify";
import { truncateAddress } from "@/lib/format";
import { GateVerdict } from "@/components/GateVerdict";
import { GateStates } from "@/components/GateStates";
import { JevTelemetry } from "@/components/JevTelemetry";
import { CopyButton } from "@/components/CopyButton";
import { Rule } from "@/components/Rule";
import { SituationCast } from "@/components/SituationCast";
import { SITE_URL } from "@/lib/site";
import { getSituation, SITUATIONS } from "@/lib/situations";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  subject?: string;
  capability?: string;
  chain?: string;
  situation?: string;
}>;

export const metadata = {
  title: "The Gate",
  description:
    "Pick your moment — treasury spend, paid API, escrow hire — then run one on-chain GO or STOP before money moves.",
  robots: { index: true, follow: true },
};

const DEMO_SUBJECTS: Record<string, { label: string; value: string }[]> = {
  "casper-testnet": [
    {
      label: "deployer account",
      value:
        "account-hash-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1",
    },
    {
      label: "issuer account",
      value:
        "account-hash-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37",
    },
  ],
  "pharos-atlantic": [
    {
      label: "sample agent",
      value: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    },
  ],
  "monad-testnet": [
    {
      label: "deployer agent",
      value: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    },
  ],
};

/**
 * Demo capabilities, restricted to ids that actually exist in the registry.
 * A link to an id the registry does not know resolves to "Unknown capability",
 * which reads as a broken demo — so unknown ids are dropped rather than shown.
 */
const DEMO_CAPABILITY_IDS = [
  "kyc.basic",
  "rwa.accredited",
  "agent.commerce.escrow",
  "agent.commerce.swap",
];

const DEMO_CAPABILITIES = DEMO_CAPABILITY_IDS.filter((id) =>
  capabilities.some((c) => c.id === id),
);

function verifyHref(
  chain: ChainNetwork,
  subject: string,
  capability: string,
  situation?: string,
): string {
  const sit = situation ? `&situation=${situation}` : "";
  return `/gate?chain=${chain.id}&subject=${subject}&capability=${capability}${sit}`;
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const chain = getChain(params);
  const situation = getSituation(params.situation);
  const demoSubjects = DEMO_SUBJECTS[chain.id] ?? [];
  const casper = isCasperChain(chain);

  // Situation picks the capability when the visitor hasn't chosen one yet.
  const rawCap = params.capability ?? situation?.capability ?? undefined;
  const rawSubject = params.subject;
  const defaultSubject = demoSubjects[0]?.value;

  // Auto-run a live verdict when a situation is chosen but no subject yet —
  // use the chain's sample agent so "Try this gate" isn't an empty room.
  const subjectForVerdict =
    rawSubject ?? (situation ? defaultSubject : undefined);
  const capForVerdict = rawCap;
  const showVerdict = Boolean(subjectForVerdict && capForVerdict);

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · Gate</p>
        <span className="font-mono tabular text-ink-quiet">
          {chain.name.toLowerCase()}
          {chain.chainId ? ` · chain ${chain.chainId}` : ""}
        </span>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          {situation
            ? situation.moment.replace(/\.$/, "") + "."
            : "The gate before the payment."}
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-ink-soft">
          {situation ? (
            <>
              You&rsquo;re in the{" "}
              <span className="text-ink">{situation.role.toLowerCase()}</span>{" "}
              seat. Without Ligis: {situation.without.toLowerCase()}. With it:{" "}
              {situation.withLigis.toLowerCase()}.
            </>
          ) : (
            <>
              Pick a situation you recognize, then run one on-chain read. The
              answer comes from {chain.name} state — so your agent can trust it
              the instant before money moves.
            </>
          )}
        </p>
        {situation ? (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
            {situation.integrator}
            <span className="mx-2">·</span>
            <code className="normal-case tracking-normal text-ink-soft">
              {situation.capability}
            </code>
            <span className="mx-2">·</span>
            <a
              href={`/gate?chain=${chain.id}`}
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              all situations
            </a>
          </p>
        ) : (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
            {CHAINS.map((c, i) => (
              <span key={c.id}>
                {i > 0 ? " · " : ""}
                {c.id === chain.id ? (
                  <span className="text-ink">{c.name.toLowerCase()}</span>
                ) : (
                  <a
                    href={`/gate?chain=${c.id}`}
                    className="underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                  >
                    {c.name.toLowerCase()}
                  </a>
                )}
              </span>
            ))}
          </p>
        )}
      </section>

      {!situation ? (
        <div className="mt-14">
          <SituationCast chainId={chain.id} />
        </div>
      ) : (
        <div className="mt-12">
          <p className="eyebrow">Other situations</p>
          <Rule className="mt-3" />
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em]">
            {SITUATIONS.map((s) => (
              <li key={s.id}>
                {s.id === situation.id ? (
                  <span className="text-ink">{s.role}</span>
                ) : (
                  <a
                    href={`/gate?chain=${chain.id}&situation=${s.id}&capability=${s.capability}`}
                    className="text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                  >
                    {s.role}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="mt-14">
        <GateStates />
      </section>

      <section className="mt-14">
        <JevTelemetry />
      </section>

      <section className="mt-14">
        <h2 className="eyebrow">Subject &amp; capability</h2>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          {situation
            ? "Capability is set from your situation. Swap the subject to see GO vs STOP on a real wallet."
            : "Or skip the cast and pick a subject and capability directly."}
        </p>
        <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div>
            <p className="eyebrow">Subject</p>
            <Rule className="mt-3" />
            <ul className="mt-4 space-y-2 font-mono text-xs">
              {demoSubjects.map((s) => (
                <li key={s.value}>
                  <a
                    className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                    href={verifyHref(
                      chain,
                      s.value,
                      rawCap ?? situation?.capability ?? "kyc.basic",
                      situation?.id,
                    )}
                  >
                    {s.label}
                  </a>
                  <p className="mt-1 pl-2 text-[11px] text-ink-quiet">
                    {truncateAddress(s.value, 12, 6)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">Capability</p>
            <Rule className="mt-3" />
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
              {DEMO_CAPABILITIES.map((c) => {
                const subjectForCap =
                  subjectForVerdict ?? demoSubjects[0]?.value;
                const selected = (rawCap ?? situation?.capability) === c;
                return (
                  <li key={c}>
                    {subjectForCap ? (
                      <a
                        className={`underline decoration-1 underline-offset-4 ${
                          selected
                            ? "text-ink decoration-terra"
                            : "text-ink-soft decoration-rule hover:text-ink hover:decoration-terra"
                        }`}
                        href={verifyHref(
                          chain,
                          subjectForCap,
                          c,
                          situation?.id,
                        )}
                      >
                        {c}
                      </a>
                    ) : (
                      <span className="text-ink-quiet">{c}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {showVerdict && subjectForVerdict && capForVerdict ? (
        <section className="mt-16">
          <h2 className="eyebrow">Verdict</h2>
          <div className="mt-6">
            <Result
              chain={chain}
              subject={subjectForVerdict}
              capability={capForVerdict}
            />
          </div>
        </section>
      ) : (
        <section className="mt-16">
          <h2 className="eyebrow">Verdict</h2>
          <p className="mt-4 font-serif text-base italic text-ink-quiet">
            Pick a situation above — or a subject and capability — to run the
            gate.
          </p>
        </section>
      )}

      {showVerdict && subjectForVerdict && capForVerdict ? (
        <section className="mt-12">
          <h2 className="eyebrow">Share this gate</h2>
          <p className="mt-4 max-w-2xl font-serif text-base leading-relaxed text-ink-soft">
            A gate link is a self-verifying URL &mdash; anyone who opens it
            re-runs the same on-chain read and sees the same decision. No
            account, no token, no Ligis server in the path. Hand it to an agent,
            paste it in an audit trail, or drop it where a payment is about to
            happen.
          </p>
          <div className="mt-5 flex flex-wrap items-baseline gap-4">
            <code className="block min-w-0 flex-1 basis-72 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
              {`${SITE_URL}/gate?chain=${chain.id}&subject=${subjectForVerdict}&capability=${capForVerdict}${situation ? `&situation=${situation.id}` : ""}`}
            </code>
            <CopyButton
              value={`${SITE_URL}/gate?chain=${chain.id}&subject=${subjectForVerdict}&capability=${capForVerdict}${situation ? `&situation=${situation.id}` : ""}`}
              label="copy"
              className="shrink-0"
            />
          </div>
        </section>
      ) : null}

      <section className="mt-16">
        <h2 className="eyebrow">API</h2>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          The same path works as a shareable, self-verifying URL for
          programmatic checks and audit trails. The{" "}
          <code className="font-mono">/gate</code> verb aliases{" "}
          <code className="font-mono">/verify</code> &mdash; use either.
        </p>
        <pre className="mt-4 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
          {`GET /gate?chain=${chain.id}&subject=${casper ? "account-hash-..." : "0x..."}&capability=${capForVerdict ?? "kyc.basic"}`}
        </pre>
      </section>

      <footer className="route-footer mt-16 text-xs text-ink-quiet">
        <a
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </a>
        <a
          href={chain.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          {casper ? "cspr.live" : "pharosscan"} ↗
        </a>
      </footer>
    </main>
  );
}

async function Result({
  chain,
  subject,
  capability,
}: {
  chain: ChainNetwork;
  subject: string;
  capability: string;
}) {
  const outcome = await verifySubject(chain, subject, capability);

  if (!outcome.ok) {
    return <p className="font-serif text-base text-revoke">{outcome.error}</p>;
  }

  return (
    <GateVerdict
      verdict={{
        capable: outcome.capable,
        subject: outcome.subject,
        capabilityId: outcome.capabilityId,
        issuer: outcome.issuer,
        expiresAt: outcome.expiresAt,
        revoked: outcome.revoked,
      }}
      explorerUrl={chain.explorerUrl}
      source={`${chain.name} state`}
    />
  );
}
