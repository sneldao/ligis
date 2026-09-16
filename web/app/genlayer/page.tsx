import Link from "next/link";
import { Rule } from "@/components/Rule";
import { CopyButton } from "@/components/CopyButton";
import { truncateAddress } from "@/lib/format";
import { GENLAYER_STUDIO_NEXT, JOB_STATUSES } from "@ligis/core";
import { readJobEscrowAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "GenLayer JobEscrow — Agent Tank",
  description:
    "Ligis gates who may trade. GenLayer adjudicates what happened when delivery is disputed. Live JobEscrow state on Studio Next (chain 61997).",
  robots: { index: true, follow: true },
};

type SearchParams = Promise<{ job?: string }>;

const STATUS_TONE: Record<string, string> = {
  open: "text-sky",
  delivered: "text-sky",
  disputed: "text-terra",
  resolved_release: "text-sage",
  resolved_refund: "text-revoke",
};

const STATUS_BORDER: Record<string, string> = {
  open: "border-sky",
  delivered: "border-sky",
  disputed: "border-terra",
  resolved_release: "border-sage",
  resolved_refund: "border-revoke",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Awaiting delivery",
  delivered: "Delivered — buyer may dispute",
  disputed: "Disputed — AI-jury adjudicating",
  resolved_release: "Approved — stake released to seller",
  resolved_refund: "Rejected — stake refunded to buyer",
};

export default async function GenLayerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requestedJobId = params.job ? Number(params.job) : undefined;
  const result = await readJobEscrowAction(requestedJobId);

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis × GenLayer · Agent Tank</p>
        <span className="font-mono tabular text-ink-quiet">
          studio next · chain {GENLAYER_STUDIO_NEXT.chainId}
        </span>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          Who may trade. What happened.
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-ink-soft">
          Ligis decides who may trade — a deterministic gate, checked off-chain
          before money moves. GenLayer decides what happened when agents
          disagree on delivery — a non-deterministic AI-jury verdict, reached by
          consensus. This page reads the live JobEscrow Intelligent Contract on
          Studio Next.
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          <Link
            href="/gate?chain=casper-testnet"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← ligis gate
          </Link>
          {" · "}
          <span className="text-ink">genlayer escrow</span>
          {" · "}
          <a
            href="https://portal.genlayer.foundation/agent-tank/hackathon/"
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            portal ↗
          </a>
        </p>
      </section>

      <Rule className="mt-12" />

      {/* ── Contract / deploy status ────────────────────────────────── */}
      {!result.ok ? (
        <section className="mt-8">
          <h2 className="eyebrow">Contract</h2>
          <p className="mt-4 font-serif text-base italic text-ink-quiet">
            {result.error}
          </p>
          {result.lastrun && (
            <p className="mt-2 font-mono text-[11px] text-ink-quiet">
              last run: {result.lastrun.runAt ?? "unknown"}
            </p>
          )}
          <details className="group mt-6 border-t border-rule">
            <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
              <span className="group-open:hidden">Show demo commands +</span>
              <span className="hidden group-open:inline">
                Hide demo commands −
              </span>
            </summary>
            <div className="pb-6">
              <pre className="overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
                {`pnpm demo:genlayer --mock-gate   # deploy + full flow
pnpm demo:genlayer --dry-run       # Ligis gate only`}
              </pre>
            </div>
          </details>
        </section>
      ) : (
        <>
          {/* ── Contract address ─────────────────────────────────────── */}
          <section className="mt-8">
            <h2 className="eyebrow">Contract</h2>
            <Rule className="mt-3" />
            <div className="mt-4 space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                  address
                </span>
                <code className="font-mono text-sm tabular text-ink">
                  {truncateAddress(result.address, 10, 8)}
                </code>
                <CopyButton value={result.address} />
              </div>
              <div className="flex items-baseline gap-3">
                <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                  explorer
                </span>
                <a
                  href={result.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                >
                  {truncateAddress(result.address, 14, 10)} ↗
                </a>
              </div>
              {result.jobCount !== null && (
                <div className="flex items-baseline gap-3">
                  <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                    jobs
                  </span>
                  <span className="font-mono text-sm tabular text-ink">
                    {result.jobCount.toString()}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* ── Job verdict (the answer) ──────────────────────────────── */}
          {result.job && (
            <section className="mt-12">
              <div
                className={`border-l-2 pl-6 ${STATUS_BORDER[result.job.status] ?? "border-rule"}`}
              >
                <p className="eyebrow">job #{result.job.id} · current state</p>
                <p className="mt-3 display text-3xl sm:text-4xl">
                  <span
                    className={STATUS_TONE[result.job.status] ?? "text-ink"}
                  >
                    {result.job.status === "open" && "○ Open"}
                    {result.job.status === "delivered" && "○ Delivered"}
                    {result.job.status === "disputed" && "● Disputed"}
                    {result.job.status === "resolved_release" && "✓ Approved"}
                    {result.job.status === "resolved_refund" && "✗ Rejected"}
                  </span>
                </p>
                <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
                  {STATUS_LABEL[result.job.status] ?? result.job.status}
                  {result.job.claimed && " · funds claimed."}
                </p>
                {result.job.verdictSummary && (
                  <p className="mt-3 font-serif text-base italic leading-relaxed text-ink">
                    &ldquo;{result.job.verdictSummary}&rdquo;
                  </p>
                )}
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                  {result.job.requiredCapability} · stake {result.job.stake} wei
                </p>
              </div>
            </section>
          )}

          {/* ── Job ledger (the details) ─────────────────────────────── */}
          {result.job && (
            <section className="mt-12">
              <h2 className="eyebrow">Job details</h2>
              <Rule className="mt-3" />
              <div className="mt-4">
                <LedgerRow label="brief">
                  <span className="font-serif text-base text-ink-soft">
                    {result.job.brief}
                  </span>
                </LedgerRow>
                <Rule tone="soft" />
                <LedgerRow label="seller">
                  <span className="inline-flex items-baseline gap-2">
                    <code className="font-mono text-sm tabular text-ink">
                      {truncateAddress(result.job.seller, 10, 8)}
                    </code>
                    <CopyButton value={result.job.seller} />
                  </span>
                </LedgerRow>
                <Rule tone="soft" />
                <LedgerRow label="buyer">
                  <span className="inline-flex items-baseline gap-2">
                    <code className="font-mono text-sm tabular text-ink">
                      {truncateAddress(result.job.buyer, 10, 8)}
                    </code>
                    <CopyButton value={result.job.buyer} />
                  </span>
                </LedgerRow>
                <Rule tone="soft" />
                <LedgerRow label="stake">
                  <span className="font-mono text-sm tabular text-ink">
                    {result.job.stake} wei
                  </span>
                </LedgerRow>
                {result.job.evidenceUri && (
                  <>
                    <Rule tone="soft" />
                    <LedgerRow label="evidence">
                      <a
                        href={result.job.evidenceUri}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 break-all hover:text-ink hover:decoration-terra"
                      >
                        {result.job.evidenceUri}
                      </a>
                    </LedgerRow>
                  </>
                )}
                {result.job.disputeReason && (
                  <>
                    <Rule tone="soft" />
                    <LedgerRow label="dispute">
                      <span className="font-serif text-base italic text-ink-soft">
                        &ldquo;{result.job.disputeReason}&rdquo;
                      </span>
                    </LedgerRow>
                  </>
                )}
                <Rule tone="soft" />
                <LedgerRow label="capability">
                  <span className="font-mono text-sm text-ink-soft">
                    {result.job.requiredCapability}
                  </span>
                </LedgerRow>
                <Rule tone="soft" />
                <LedgerRow label="claimed">
                  <span className="font-mono text-sm text-ink">
                    {result.job.claimed ? "yes" : "no"}
                  </span>
                </LedgerRow>
              </div>
            </section>
          )}

          {/* ── Lifecycle ledger ─────────────────────────────────────── */}
          {result.job && (
            <section className="mt-12">
              <h2 className="eyebrow">Lifecycle</h2>
              <Rule className="mt-3" />
              <div className="mt-4">
                {JOB_STATUSES.map((s, i) => {
                  const active = result.job!.status === s;
                  const past =
                    JOB_STATUSES.indexOf(
                      result.job!.status as (typeof JOB_STATUSES)[number],
                    ) >= i;
                  return (
                    <div key={s}>
                      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-8 py-3">
                        <span
                          className={`font-mono text-sm ${
                            active
                              ? `${STATUS_TONE[s] ?? "text-ink"} font-bold`
                              : past
                                ? "text-ink-soft"
                                : "text-ink-quiet"
                          }`}
                        >
                          {s.replace(/_/g, " ")}
                        </span>
                        <span
                          className={`font-mono text-[11px] tabular ${
                            active
                              ? (STATUS_TONE[s] ?? "text-ink")
                              : "text-ink-quiet"
                          }`}
                        >
                          {active ? "● here" : past ? "✓ done" : "—"}
                        </span>
                      </div>
                      {i < JOB_STATUSES.length - 1 && <Rule tone="soft" />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Ligis gate receipt (disclosed on intent) ─────────────── */}
          {result.gateReceipt && (
            <section className="mt-12">
              <details className="group">
                <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
                  <span className="group-open:hidden">
                    Ligis gate receipt (on-chain) +
                  </span>
                  <span className="hidden group-open:inline">
                    Ligis gate receipt (on-chain) −
                  </span>
                </summary>
                <div className="mt-6">
                  <div
                    className={`border-l-2 pl-6 ${result.gateReceipt.capable ? "border-sage" : "border-revoke"}`}
                  >
                    <p className="eyebrow">gate · pre-payment check</p>
                    <p className="mt-3 display text-3xl">
                      <span
                        className={
                          result.gateReceipt.capable
                            ? "text-sage"
                            : "text-revoke"
                        }
                      >
                        {result.gateReceipt.capable ? "✓ GO" : "✗ STOP"}
                      </span>
                    </p>
                    <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
                      {result.gateReceipt.capable
                        ? "Authorized on-chain. The seller's agent may proceed."
                        : "No verifiable authorization. The agent must not proceed."}
                    </p>
                    <div className="mt-6 space-y-2">
                      <LedgerRow label="subject">
                        <code className="font-mono text-sm tabular text-ink">
                          {truncateAddress(result.gateReceipt.subject, 14, 8)}
                        </code>
                      </LedgerRow>
                      <LedgerRow label="capability">
                        <span className="font-mono text-sm text-ink-soft">
                          {result.gateReceipt.capability}
                        </span>
                      </LedgerRow>
                      <LedgerRow label="ligis chain">
                        <span className="font-mono text-sm text-ink-soft">
                          {result.gateReceipt.ligisChain}
                        </span>
                      </LedgerRow>
                      <LedgerRow label="proof ref">
                        <span className="font-mono text-sm text-ink-soft break-all">
                          {result.gateReceipt.proofRef}
                        </span>
                      </LedgerRow>
                      <LedgerRow label="checked at">
                        <span className="font-mono text-sm tabular text-ink-soft">
                          {result.gateReceipt.checkedAt > 0
                            ? new Date(
                                result.gateReceipt.checkedAt * 1000,
                              ).toISOString()
                            : "—"}
                        </span>
                      </LedgerRow>
                      {result.gateReceipt.capabilityHash && (
                        <LedgerRow label="cap hash">
                          <span className="font-mono text-sm tabular text-ink-soft">
                            {truncateAddress(
                              result.gateReceipt.capabilityHash,
                              10,
                              8,
                            )}
                          </span>
                        </LedgerRow>
                      )}
                    </div>
                    <p className="mt-6">
                      <Link
                        href={`/gate?chain=${result.gateReceipt.ligisChain}&subject=${encodeURIComponent(result.gateReceipt.subject)}&capability=${encodeURIComponent(result.gateReceipt.capability)}`}
                        className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                      >
                        re-run ligis gate ↗
                      </Link>
                    </p>
                  </div>
                </div>
              </details>
            </section>
          )}

          {/* ── Last demo run (disclosed on intent) ──────────────────── */}
          {result.lastrun && (
            <section className="mt-12">
              <details className="group">
                <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
                  <span className="group-open:hidden">Last demo run +</span>
                  <span className="hidden group-open:inline">
                    Last demo run −
                  </span>
                </summary>
                <div className="mt-6 space-y-2">
                  {result.lastrun.runAt && (
                    <LedgerRow label="run at">
                      <span className="font-mono text-sm text-ink-soft">
                        {result.lastrun.runAt}
                      </span>
                    </LedgerRow>
                  )}
                  {result.lastrun.finalStatus && (
                    <LedgerRow label="final status">
                      <span
                        className={
                          STATUS_TONE[result.lastrun.finalStatus] ?? "text-ink"
                        }
                      >
                        {result.lastrun.finalStatus}
                      </span>
                    </LedgerRow>
                  )}
                  {result.lastrun.verdictSummary && (
                    <LedgerRow label="verdict">
                      <span className="font-mono text-sm text-ink-soft">
                        {result.lastrun.verdictSummary}
                      </span>
                    </LedgerRow>
                  )}
                </div>
              </details>
            </section>
          )}

          {/* ── How this works (disclosed on intent) ─────────────────── */}
          <section className="mt-12">
            <details className="group">
              <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
                <span className="group-open:hidden">How this works +</span>
                <span className="hidden group-open:inline">
                  How this works −
                </span>
              </summary>
              <div className="mt-6 pb-4">
                <ol className="space-y-4 font-serif text-base leading-relaxed text-ink-soft">
                  <li>
                    <span className="font-mono text-[11px] text-ink-quiet">
                      1.{" "}
                    </span>
                    <Link
                      href="/gate?chain=casper-testnet"
                      className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
                    >
                      Ligis gate
                    </Link>{" "}
                    checks the seller&rsquo;s capability on Casper. GO or STOP —
                    from chain state, not a Ligis server.
                  </li>
                  <li>
                    <span className="font-mono text-[11px] text-ink-quiet">
                      2.{" "}
                    </span>
                    The gate receipt is passed to{" "}
                    <code className="font-mono text-sm text-ink">
                      create_job
                    </code>{" "}
                    on the GenLayer JobEscrow. The contract asserts{" "}
                    <code className="font-mono text-sm text-ink">
                      capable == true
                    </code>{" "}
                    and stores the receipt on-chain.
                  </li>
                  <li>
                    <span className="font-mono text-[11px] text-ink-quiet">
                      3.{" "}
                    </span>
                    Seller submits a deliverable. Buyer disputes. GenLayer
                    validators fetch the deliverable from the web and ask an LLM
                    to judge it against the brief.
                  </li>
                  <li>
                    <span className="font-mono text-[11px] text-ink-quiet">
                      4.{" "}
                    </span>
                    Consensus on the binary verdict (APPROVED / REJECTED).{" "}
                    <code className="font-mono text-sm text-ink">claim()</code>{" "}
                    pays the seller or refunds the buyer.
                  </li>
                </ol>
              </div>
            </details>
          </section>
        </>
      )}

      {/* ── Route footer ────────────────────────────────────────────── */}
      <footer className="route-footer mt-16 text-xs text-ink-quiet">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
        {result.ok && (
          <a
            href={result.explorer}
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            explorer ↗
          </a>
        )}
      </footer>
    </main>
  );
}

function LedgerRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6 py-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
