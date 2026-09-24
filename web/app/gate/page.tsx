import { Suspense } from "react";
import { CHAINS, getChain, type ChainNetwork } from "@/lib/network";
import { capabilities } from "@/lib/chain";
import { isCasperChain } from "@/lib/chain-router";
import { verifySubject } from "@/lib/verify";
import { DEMO_GATE_SAMPLES } from "@/lib/demo-subjects";
import { GateVerdict } from "@/components/GateVerdict";
import { GateStates } from "@/components/GateStates";
import { GateFormShell } from "@/components/GateFormShell";
import { ChainSwitchHint } from "@/components/ChainSwitchHint";
import { JevTelemetry } from "@/components/JevTelemetry";
import { CopyButton } from "@/components/CopyButton";
import { Rule } from "@/components/Rule";
import { SituationCast } from "@/components/SituationCast";
import { SITE_URL } from "@/lib/site";
import { getSituation, SITUATIONS } from "@/lib/situations";
import { chainSwitchHref } from "@/lib/subject-format";

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
  const demoSubjects = DEMO_GATE_SAMPLES[chain.id] ?? [];
  const casper = isCasperChain(chain);

  const rawCap = params.capability ?? situation?.capability ?? undefined;
  const rawSubject = params.subject;
  const defaultSample = demoSubjects[0];
  const defaultSubject = defaultSample?.subject ?? "";
  const defaultCapability =
    rawCap ?? situation?.capability ?? defaultSample?.capability ?? "kyc.basic";

  const subjectForVerdict =
    rawSubject ?? (situation ? defaultSubject : undefined);
  const capForVerdict = rawCap ?? (situation ? defaultCapability : undefined);
  const showVerdict = Boolean(subjectForVerdict && capForVerdict);

  const sampleLinks =
    demoSubjects.length > 0 ? (
      <p className="mt-4 font-mono text-xs text-ink-quiet">
        or try:{" "}
        {demoSubjects.map((s, i) => (
          <span key={`${s.label}-${s.capability}`}>
            {i > 0 ? " · " : ""}
            <a
              className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              href={verifyHref(chain, s.subject, s.capability, situation?.id)}
            >
              {s.label}
            </a>
          </span>
        ))}
      </p>
    ) : null;

  const verdictBlock =
    showVerdict && subjectForVerdict && capForVerdict ? (
      <>
        <section className="mt-16">
          <h2 className="eyebrow">Verdict</h2>
          <div className="mt-6">
            <Suspense
              fallback={
                <p className="font-serif text-lg italic text-ink-quiet">
                  Reading chain…
                </p>
              }
            >
              <Result
                chain={chain}
                subject={subjectForVerdict}
                capability={capForVerdict}
              />
            </Suspense>
          </div>
        </section>
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
      </>
    ) : (
      <section className="mt-16">
        <h2 className="eyebrow">Verdict</h2>
        <p className="mt-4 font-serif text-base italic text-ink-quiet">
          Run the gate above — or pick a situation below — to see the decision.
        </p>
      </section>
    );

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

      <GateFormShell
        chainId={chain.id}
        situationId={situation?.id}
        defaultSubject={rawSubject ?? defaultSubject}
        defaultCapability={defaultCapability}
        capabilityOptions={capabilities}
        sampleLinks={sampleLinks}
      >
        {verdictBlock}
      </GateFormShell>

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
          {casper ? "cspr.live" : "explorer"} ↗
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
    const href = outcome.mismatch
      ? chainSwitchHref({
          path: "/gate",
          chainId: outcome.mismatch.suggestedChainId,
          subject,
          capability,
        })
      : null;
    return (
      <div className="space-y-3">
        <p role="alert" className="font-serif text-base text-revoke">
          {outcome.error}
        </p>
        {outcome.mismatch && href ? (
          <ChainSwitchHint mismatch={outcome.mismatch} href={href} />
        ) : null}
      </div>
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
