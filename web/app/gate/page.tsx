import { CHAINS, getChain, type ChainNetwork } from "@/lib/network";
import { capabilities } from "@/lib/chain";
import { isCasperChain } from "@/lib/chain-router";
import { verifySubject } from "@/lib/verify";
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
      label: "verified agent",
      value:
        "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326",
    },
    {
      label: "unverified wallet",
      value:
        "account-hash-0000000000000000000000000000000000000000000000000000000000000001",
    },
  ],
  "pharos-atlantic": [
    {
      label: "verified agent",
      value: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    },
    {
      label: "unverified wallet",
      value: "0x000000000000000000000000000000000000dEaD",
    },
  ],
  "monad-testnet": [
    {
      label: "deployer agent",
      value: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    },
  ],
};

function gateParams(
  chain: ChainNetwork,
  subject: string,
  capability: string,
  situation?: string,
): string {
  const params = new URLSearchParams();
  params.set("chain", chain.id);
  params.set("subject", subject);
  params.set("capability", capability);
  if (situation) params.set("situation", situation);
  return params.toString();
}

function verifyHref(
  chain: ChainNetwork,
  subject: string,
  capability: string,
  situation?: string,
): string {
  return `/gate?${gateParams(chain, subject, capability, situation)}`;
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

      <section className="mt-14">
        <form
          method="get"
          action="/gate"
          className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <input type="hidden" name="chain" value={chain.id} />
          {situation ? (
            <input type="hidden" name="situation" value={situation.id} />
          ) : null}
          <label htmlFor="subject" className="block space-y-2">
            <span className="eyebrow">subject · wallet</span>
            <input
              id="subject"
              name="subject"
              defaultValue={rawSubject ?? defaultSubject}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="block w-full border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra"
            />
          </label>
          <label htmlFor="capability" className="block space-y-2">
            <span className="eyebrow">capability</span>
            <span className="relative block">
              <select
                id="capability"
                name="capability"
                defaultValue={rawCap ?? situation?.capability ?? "kyc.basic"}
                className="block w-full appearance-none border-0 border-b border-rule bg-transparent pb-2 pr-6 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra"
              >
                {capabilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
              </select>
              <svg
                width="9"
                height="9"
                viewBox="0 0 9 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
                className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-ink-quiet"
              >
                <path d="M1.5 3 L4.5 6 L7.5 3" />
              </svg>
            </span>
          </label>
          <button
            type="submit"
            className="inline-flex items-center gap-2 justify-center border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper"
            style={{ borderRadius: 0 }}
          >
            gate →
          </button>
        </form>
        {demoSubjects.length > 0 ? (
          <p className="mt-4 font-mono text-xs text-ink-quiet">
            or try:{" "}
            {demoSubjects.map((s, i) => (
              <span key={s.value}>
                {i > 0 ? " · " : ""}
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
              </span>
            ))}
          </p>
        ) : null}
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
            Run the gate above — or pick a situation below — to see the
            decision.
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
              {`${SITE_URL}/gate?${gateParams(chain, subjectForVerdict, capForVerdict, situation?.id)}`}
            </code>
            <CopyButton
              value={`${SITE_URL}/gate?${gateParams(chain, subjectForVerdict, capForVerdict, situation?.id)}`}
              label="copy"
              className="shrink-0"
            />
          </div>
        </section>
      ) : null}

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
    return (
      <p role="alert" className="font-serif text-base text-revoke">
        {outcome.error}
      </p>
    );
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
