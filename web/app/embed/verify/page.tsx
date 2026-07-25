import type { Address } from "viem";
import { getChain, type ChainNetwork } from "@/lib/network";
import { verifySubject } from "@/lib/verify";
import { monthYear, truncateAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ subject?: string; capability?: string; chain?: string }>;

export const metadata = {
  title: "Verify · Ligis",
  robots: { index: false, follow: false },
};

export default async function EmbedVerifyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { subject: rawSubject, capability: rawCap } = params;
  const chain = getChain(params);

  if (!rawSubject || !rawCap) {
    return <Frame chain={chain} error="Missing parameters. Use ?subject=0x...&capability=kyc.basic" />;
  }

  // Non-live chains can't do on-chain verification.
  if (!chain.live) {
    return <Frame chain={chain} error={`${chain.name} is not yet live.`} />;
  }

  const outcome = await verifySubject(chain, rawSubject, rawCap);

  if (!outcome.ok) {
    return <Frame chain={chain} error={outcome.error} />;
  }

  return (
    <Frame
      chain={chain}
      subject={outcome.subject as Address}
      capabilityId={outcome.capabilityId}
      capable={outcome.capable}
      issuer={outcome.issuer}
      expiresAt={outcome.expiresAt}
    />
  );
}

function Frame(props: {
  chain: ChainNetwork;
  error?: string;
  subject?: Address;
  capabilityId?: string;
  capable?: boolean;
  issuer?: `0x${string}` | null;
  expiresAt?: bigint | null;
}) {
  const link =
    props.subject && props.capabilityId
      ? `/agent/${props.subject}`
      : "/capabilities";

  if (props.error) {
    return (
      <a
        href={link}
        className="block bg-paper px-5 py-4 text-xs font-mono text-revoke no-underline"
      >
        Ligis · {props.error}
      </a>
    );
  }

  const dotClass = props.capable ? "bg-sage" : "bg-ink-quiet";
  const verb = props.capable ? "is capable" : "is not capable";
  const ariaLabel = [
    `Ligis verification: ${truncateAddress(props.subject!, 6, 4)} ${verb} of ${props.capabilityId}`,
    props.capable && props.issuer
      ? `, issued by ${truncateAddress(props.issuer, 5, 3)}${
          props.expiresAt && props.expiresAt > 0n
            ? `, expires ${monthYear(props.expiresAt)}`
            : ", no expiry"
        }`
      : "",
    ". Opens the agent page on Ligis.",
  ].join("");

  return (
    <a
      href={link}
      target="_top"
      aria-label={ariaLabel}
      className="block bg-paper px-5 py-4 no-underline"
    >
      <div className="flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        <span>Ligis · verify</span>
        <span className="font-mono tabular">{props.chain.name.toLowerCase()}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <span
          className={`inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full ${dotClass}`}
          aria-hidden
        />
        <p className="font-serif text-base leading-snug text-ink">
          <span className="font-mono text-sm tabular">
            {truncateAddress(props.subject!, 6, 4)}
          </span>{" "}
          {verb} of{" "}
          <span className="font-mono text-sm tabular">
            {props.capabilityId}
          </span>
          .
        </p>
      </div>
      {props.capable && props.issuer ? (
        <p className="mt-1 pl-[1.4rem] font-serif text-xs italic text-ink-soft">
          Issued by{" "}
          <span className="font-mono not-italic">
            {truncateAddress(props.issuer, 5, 3)}
          </span>
          {props.expiresAt && props.expiresAt > 0n
            ? `, expires ${monthYear(props.expiresAt)}`
            : ", no expiry"}
          .
        </p>
      ) : null}
    </a>
  );
}
