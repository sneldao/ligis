import { Suspense } from "react";
import Link from "next/link";
import {
  CHAINS,
  getChain,
  isPasskeyIssuer,
  type ChainNetwork,
} from "@/lib/network";
import { capabilities } from "@/lib/chain";
import { isCasperChain } from "@/lib/chain-router";
import { verifySubject } from "@/lib/verify";
import { resolveSubject, type ChainVerdict } from "@/lib/resolve";
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
  chain: ChainNetwork | null,
  subject: string,
  capability: string,
  situation?: string,
): string {
  const params = new URLSearchParams();
  if (chain) params.set("chain", chain.id);
  params.set("subject", subject);
  params.set("capability", capability);
  if (situation) params.set("situation", situation);
  return params.toString();
}

function verifyHref(
  chain: ChainNetwork | null,
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
  // Unscoped (`?chain=` absent) is the product default: resolve the subject
  // across every registry it could live on. An explicit ?chain= gives a
  // scoped, single-registry read for demos and debugging.
  const scoped = params.chain !== undefined;
  const chain = getChain(params);
  const situation = getSituation(params.situation);
  const demoSubjects = scoped
    ? (DEMO_GATE_SAMPLES[chain.id] ?? []).map((s) => ({ ...s, tag: "" }))
    : // Monad first — richest provenance; matches candidate order in resolve.
      [...CHAINS]
        .sort((a) => (a.id === "monad-testnet" ? -1 : 0))
        .flatMap((c) =>
          (DEMO_GATE_SAMPLES[c.id] ?? []).map((s) => ({
            ...s,
            tag: ` · ${c.shortName}`,
          })),
        );
  const casper = scoped && isCasperChain(chain);

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
              href={verifyHref(
                scoped ? chain : null,
                s.subject,
                s.capability,
                situation?.id,
              )}
            >
              {s.label}
              {s.tag}
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
              {scoped ? (
                <Result
                  chain={chain}
                  subject={subjectForVerdict}
                  capability={capForVerdict}
                />
              ) : (
                <Resolved
                  subject={subjectForVerdict}
                  capability={capForVerdict}
                />
              )}
            </Suspense>
          </div>
        </section>
        <section className="mt-12">
          <h2 className="eyebrow">Share</h2>
          <p className="mt-3 max-w-xl font-serif text-sm leading-relaxed text-ink-soft">
            Anyone who opens this URL re-runs the same on-chain read. No
            account. No Ligis server.
          </p>
          <div className="mt-5 flex flex-wrap items-baseline gap-4">
            <code className="block min-w-0 flex-1 basis-72 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
              {`${SITE_URL}/gate?${gateParams(scoped ? chain : null, subjectForVerdict, capForVerdict, situation?.id)}`}
            </code>
            <CopyButton
              value={`${SITE_URL}/gate?${gateParams(scoped ? chain : null, subjectForVerdict, capForVerdict, situation?.id)}`}
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
          {scoped
            ? `${chain.name.toLowerCase()}${chain.chainId ? ` · chain ${chain.chainId}` : ""}`
            : "all registries"}
        </span>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          {situation ? situation.moment.replace(/\.$/, "") + "." : "Gate it."}
        </h1>
        <p className="mt-5 max-w-xl font-serif text-lg leading-relaxed text-ink-soft">
          {situation ? (
            <>
              <span className="text-ink">{situation.role}</span>
              <span className="mx-2 text-ink-quiet">·</span>
              <span className="text-revoke">Blind:</span> {situation.without}{" "}
              <span className="text-sage">Gated:</span> {situation.withLigis}
            </>
          ) : (
            <>
              {scoped
                ? `One on-chain read on ${chain.name}.`
                : "One read across every live registry."}{" "}
              <span className="text-sage">GO</span> or{" "}
              <span className="text-revoke">STOP</span> before money moves.
            </>
          )}
        </p>
        {situation ? (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
            <code className="normal-case tracking-normal text-ink-soft">
              {situation.capability}
            </code>
            <span className="mx-2">·</span>
            <a
              href={scoped ? `/gate?chain=${chain.id}` : "/gate"}
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              all moments
            </a>
          </p>
        ) : (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
            {!scoped ? (
              <span className="text-ink">everywhere</span>
            ) : (
              <a
                href="/gate"
                className="underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
              >
                everywhere
              </a>
            )}
            {CHAINS.map((c) => (
              <span key={c.id}>
                {" · "}
                {scoped && c.id === chain.id ? (
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
        chainId={scoped ? chain.id : undefined}
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
          <SituationCast chainId={scoped ? chain.id : undefined} />
        </div>
      ) : (
        <div className="mt-12">
          <p className="eyebrow">Other moments</p>
          <Rule className="mt-3" />
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em]">
            {SITUATIONS.map((s) => (
              <li key={s.id}>
                {s.id === situation.id ? (
                  <span className="text-ink">{s.role}</span>
                ) : (
                  <a
                    href={`/gate?${scoped ? `chain=${chain.id}&` : ""}situation=${s.id}&capability=${s.capability}`}
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
        {!scoped || chain.id === "monad-testnet" ? (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
            settled live on {scoped ? "this chain" : "Monad Testnet"} ·{" "}
            <a
              href="https://testnet.monadscan.com/tx/0x5c434cce1b5df140ce13707f23717000af850e08254a8e62aacff85e54c19b65"
              target="_blank"
              rel="noreferrer"
              className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              x402 facilitator tx 0x5c43··9b65
            </a>
          </p>
        ) : null}
      </section>

      <section className="mt-14">
        <details className="group border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
            <span className="group-open:hidden">
              Watch the gate&rsquo;s second reader +
            </span>
            <span className="hidden group-open:inline">
              Hide intent telemetry −
            </span>
          </summary>
          <div className="border-t border-rule-soft py-6">
            <JevTelemetry />
          </div>
        </details>
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
          {scoped
            ? `GET /gate?chain=${chain.id}&subject=${casper ? "account-hash-..." : "0x..."}&capability=${capForVerdict ?? "kyc.basic"}`
            : `GET /gate?subject=0x...&capability=${capForVerdict ?? "kyc.basic"}`}
        </pre>
        {!scoped ? (
          <p className="mt-3 font-serif text-sm italic leading-relaxed text-ink-quiet">
            No <code className="font-mono not-italic">chain</code> param &mdash;
            the subject resolves across every live registry. Add{" "}
            <code className="font-mono not-italic">&chain=</code> to scope the
            read to one.
          </p>
        ) : null}
      </section>

      <footer className="route-footer mt-16 text-xs text-ink-quiet">
        <a
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </a>
        {scoped ? (
          <a
            href={chain.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            {casper ? "cspr.live" : "explorer"} ↗
          </a>
        ) : null}
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

  const passkeyIssuer = isPasskeyIssuer(outcome.issuer, chain.id);

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
      issuerNote={
        passkeyIssuer ? (
          <>
            The issuer is a passkey, not a server key — the WebAuthn assertion
            was verified on-chain by Monad&rsquo;s P256 precompile at{" "}
            <span className="font-mono not-italic">0x0100</span>.{" "}
            <Link
              href="/passkey"
              className="not-italic underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              run the ceremony
            </Link>
          </>
        ) : undefined
      }
    />
  );
}

/** Per-chain evidence line for a resolved (unscoped) read. */
function ProvenanceRow({
  verdict,
  subject,
  capability,
}: {
  verdict: ChainVerdict;
  subject: string;
  capability: string;
}) {
  const { chain, outcome } = verdict;
  const state = !outcome.ok ? (
    <span className="text-ink-quiet">read unreachable</span>
  ) : outcome.capable ? (
    <span className="text-sage">
      vouched
      {isPasskeyIssuer(outcome.issuer, chain.id) ? " · passkey" : ""}
    </span>
  ) : outcome.revoked ? (
    <span className="text-revoke">revoked</span>
  ) : (
    <span className="text-ink-quiet">no credential</span>
  );

  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-soft py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] first:border-t-0">
      <span className="text-ink-soft">{chain.name.toLowerCase()}</span>
      <span className="flex items-baseline gap-4">
        {state}
        <a
          href={verifyHref(chain, subject, capability)}
          className="text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          scoped read →
        </a>
      </span>
    </div>
  );
}

/**
 * Chain-agnostic read: the subject resolves across every registry it could
 * live on; the verdict features the vouching chain and the provenance rows
 * show what each registry said.
 */
async function Resolved({
  subject,
  capability,
}: {
  subject: string;
  capability: string;
}) {
  const res = await resolveSubject(subject, capability);

  if (!res.ok) {
    return (
      <p role="alert" className="font-serif text-base text-revoke">
        {res.error}
      </p>
    );
  }

  const { primary } = res;
  const outcome = primary.outcome;
  if (!outcome.ok) return null; // resolveSubject only sets primary from ok reads
  const passkeyIssuer = isPasskeyIssuer(outcome.issuer, primary.chain.id);

  return (
    <div className="space-y-8">
      <GateVerdict
        verdict={{
          capable: res.capable,
          subject: outcome.subject,
          capabilityId: outcome.capabilityId,
          issuer: outcome.issuer,
          expiresAt: outcome.expiresAt,
          revoked: outcome.revoked,
        }}
        explorerUrl={primary.chain.explorerUrl}
        source={`${primary.chain.name} state`}
        issuerNote={
          passkeyIssuer ? (
            <>
              The issuer is a passkey, not a server key — the WebAuthn assertion
              was verified on-chain by Monad&rsquo;s P256 precompile at{" "}
              <span className="font-mono not-italic">0x0100</span>.{" "}
              <Link
                href="/passkey"
                className="not-italic underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              >
                run the ceremony
              </Link>
            </>
          ) : undefined
        }
      />
      {res.verdicts.length > 1 ? (
        <div>
          <p className="eyebrow">
            Provenance · {res.verdicts.length} registries
          </p>
          <div className="mt-3 border-t border-rule-soft">
            {res.verdicts.map((v) => (
              <ProvenanceRow
                key={v.chain.id}
                verdict={v}
                subject={res.subject}
                capability={res.capabilityId}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
