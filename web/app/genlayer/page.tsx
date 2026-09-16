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
          Ligis decides who may trade (deterministic gate, off-chain
          pre-flight). GenLayer decides what happened when agents disagree on
          delivery (non-deterministic AI-jury verdict). This page reads the live
          JobEscrow Intelligent Contract on Studio Next.
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

      {/* Contract address / deploy status */}
      <section className="mt-8">
        <h2 className="eyebrow">Contract</h2>
        {!result.ok ? (
          <div className="mt-4">
            <p className="font-serif text-base italic text-ink-quiet">
              {result.error}
            </p>
            {result.lastrun && (
              <p className="mt-2 font-mono text-[11px] text-ink-quiet">
                last run: {result.lastrun.runAt ?? "unknown"}
              </p>
            )}
            <div className="mt-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                run the demo
              </p>
              <Rule className="mt-3" />
              <pre className="mt-4 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
                {`pnpm demo:genlayer --mock-gate   # deploy + full flow
pnpm demo:genlayer --dry-run       # Ligis gate only`}
              </pre>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                address
              </span>
              <code className="font-mono text-sm tabular text-ink">
                {truncateAddress(result.address, 10, 8)}
              </code>
              <CopyButton value={result.address} />
            </div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                explorer
              </span>
              <a
                href={result.explorer}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              >
                {result.explorer} ↗
              </a>
            </div>
            {result.jobCount !== null && (
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                  jobs
                </span>
                <span className="font-mono text-sm tabular text-ink">
                  {result.jobCount.toString()}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Job state */}
      {result.ok && result.job && (
        <section className="mt-12">
          <h2 className="eyebrow">Job #{result.job.id}</h2>
          <Rule className="mt-3" />
          <dl className="mt-6 space-y-4">
            <Field label="status">
              <span
                className={`font-mono text-base ${STATUS_TONE[result.job.status] ?? "text-ink"}`}
              >
                {result.job.status}
              </span>
            </Field>
            <Field label="brief">
              <span className="font-serif text-base text-ink-soft">
                {result.job.brief}
              </span>
            </Field>
            <Field label="seller">
              <span className="font-mono text-sm tabular text-ink">
                {truncateAddress(result.job.seller, 10, 8)}
              </span>
            </Field>
            <Field label="buyer">
              <span className="font-mono text-sm tabular text-ink">
                {truncateAddress(result.job.buyer, 10, 8)}
              </span>
            </Field>
            <Field label="stake">
              <span className="font-mono text-sm tabular text-ink">
                {result.job.stake} wei
              </span>
            </Field>
            {result.job.evidenceUri && (
              <Field label="evidence">
                <a
                  href={result.job.evidenceUri}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 break-all hover:text-ink hover:decoration-terra"
                >
                  {result.job.evidenceUri}
                </a>
              </Field>
            )}
            {result.job.disputeReason && (
              <Field label="dispute">
                <span className="font-serif text-base italic text-ink-soft">
                  &ldquo;{result.job.disputeReason}&rdquo;
                </span>
              </Field>
            )}
            {result.job.verdictSummary && (
              <Field label="verdict">
                <span className="font-serif text-base text-ink">
                  {result.job.verdictSummary}
                </span>
              </Field>
            )}
            <Field label="capability">
              <span className="font-mono text-sm text-ink-soft">
                {result.job.requiredCapability}
              </span>
            </Field>
            <Field label="claimed">
              <span className="font-mono text-sm text-ink">
                {result.job.claimed ? "yes" : "no"}
              </span>
            </Field>
          </dl>

          {/* Lifecycle visualization */}
          <div className="mt-8">
            <p className="eyebrow">Lifecycle</p>
            <Rule className="mt-3" />
            <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px]">
              {JOB_STATUSES.map((s, i) => {
                const active = result.job!.status === s;
                const past =
                  JOB_STATUSES.indexOf(result.job!.status as any) >= i;
                return (
                  <span key={s}>
                    {i > 0 && (
                      <span className={past ? "text-ink-quiet" : "text-rule"}>
                        {" → "}
                      </span>
                    )}
                    <span
                      className={
                        active
                          ? `${STATUS_TONE[s] ?? "text-ink"} font-bold`
                          : past
                            ? "text-ink-soft"
                            : "text-rule"
                      }
                    >
                      {s}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Gate receipt (Ligis proof on-chain) */}
      {result.ok && result.gateReceipt && (
        <section className="mt-12">
          <h2 className="eyebrow">Ligis gate receipt (on-chain)</h2>
          <p className="mt-4 max-w-2xl font-serif text-base leading-relaxed text-ink-soft">
            The Ligis pre-flight verdict is stored in contract state. A judge
            can open the explorer and see the proof — not just hear it in the
            voiceover.
          </p>
          <Rule className="mt-4" />
          <dl className="mt-6 space-y-3">
            <Field label="capable">
              <span
                className={
                  result.gateReceipt.capable
                    ? "font-mono text-base text-sage"
                    : "font-mono text-base text-revoke"
                }
              >
                {result.gateReceipt.capable ? "GO" : "STOP"}
              </span>
            </Field>
            <Field label="subject">
              <span className="font-mono text-sm tabular text-ink">
                {truncateAddress(result.gateReceipt.subject, 14, 8)}
              </span>
            </Field>
            <Field label="capability">
              <span className="font-mono text-sm text-ink-soft">
                {result.gateReceipt.capability}
              </span>
            </Field>
            <Field label="ligis chain">
              <span className="font-mono text-sm text-ink-soft">
                {result.gateReceipt.ligisChain}
              </span>
            </Field>
            <Field label="proof ref">
              <span className="font-mono text-sm text-ink-soft break-all">
                {result.gateReceipt.proofRef}
              </span>
            </Field>
            <Field label="checked at">
              <span className="font-mono text-sm tabular text-ink-soft">
                {new Date(result.gateReceipt.checkedAt * 1000).toISOString()}
              </span>
            </Field>
            {result.gateReceipt.capabilityHash && (
              <Field label="cap hash">
                <span className="font-mono text-sm tabular text-ink-soft">
                  {truncateAddress(result.gateReceipt.capabilityHash, 10, 8)}
                </span>
              </Field>
            )}
          </dl>
          <p className="mt-6">
            <Link
              href={`/gate?chain=${result.gateReceipt.ligisChain}&subject=${encodeURIComponent(result.gateReceipt.subject)}&capability=${encodeURIComponent(result.gateReceipt.capability)}`}
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              re-run ligis gate ↗
            </Link>
          </p>
        </section>
      )}

      {/* Last run summary (from lastrun.txt) */}
      {result.ok && result.lastrun && (
        <section className="mt-12">
          <h2 className="eyebrow">Last demo run</h2>
          <Rule className="mt-3" />
          <dl className="mt-6 space-y-2 font-mono text-[12px]">
            {result.lastrun.runAt && (
              <Field label="run at">
                <span className="text-ink-soft">{result.lastrun.runAt}</span>
              </Field>
            )}
            {result.lastrun.finalStatus && (
              <Field label="final status">
                <span
                  className={
                    STATUS_TONE[result.lastrun.finalStatus] ?? "text-ink"
                  }
                >
                  {result.lastrun.finalStatus}
                </span>
              </Field>
            )}
            {result.lastrun.verdictSummary && (
              <Field label="verdict">
                <span className="text-ink-soft">
                  {result.lastrun.verdictSummary}
                </span>
              </Field>
            )}
          </dl>
        </section>
      )}

      {/* Architecture note */}
      <section className="mt-16">
        <h2 className="eyebrow">How this works</h2>
        <Rule className="mt-3" />
        <ol className="mt-6 space-y-4 font-serif text-base leading-relaxed text-ink-soft">
          <li>
            <span className="font-mono text-[11px] text-ink-quiet">1. </span>
            <Link
              href="/gate?chain=casper-testnet"
              className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Ligis gate
            </Link>{" "}
            checks the seller&rsquo;s capability on Casper. GO or STOP — from
            chain state, not a Ligis server.
          </li>
          <li>
            <span className="font-mono text-[11px] text-ink-quiet">2. </span>
            The gate receipt is passed to{" "}
            <code className="font-mono text-sm text-ink">create_job</code> on
            the GenLayer JobEscrow. The contract asserts{" "}
            <code className="font-mono text-sm text-ink">capable == true</code>{" "}
            and stores the receipt on-chain.
          </li>
          <li>
            <span className="font-mono text-[11px] text-ink-quiet">3. </span>
            Seller submits a deliverable. Buyer disputes. GenLayer validators
            fetch the deliverable from the web and ask an LLM to judge it
            against the brief.
          </li>
          <li>
            <span className="font-mono text-[11px] text-ink-quiet">4. </span>
            Consensus on the binary verdict (APPROVED / REJECTED).{" "}
            <code className="font-mono text-sm text-ink">claim()</code> pays the
            seller or refunds the buyer.
          </li>
        </ol>
      </section>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
