import type { Address, Hex } from "viem";
import { capabilities, isCapable, network, readCredential } from "@/lib/chain";
import { isCapable as isCapableCasper, readCredential as readCredentialCasper, isCasperAddress } from "@/lib/chain-casper";
import { isCasperChain } from "@/lib/chain-router";
import { getChain } from "@/lib/network";
import { isAddressLike, monthYear, truncateAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ subject?: string; capability?: string; chain?: string }>;

function withTimeout<T>(operation: Promise<T>, timeoutMs = 6_000): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("verification timed out")), timeoutMs);
    }),
  ]);
}

export const metadata = {
  title: "Verify · Ligis",
  robots: { index: false, follow: false },
};

export default async function EmbedVerifyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { subject: rawSubject, capability: rawCap } = await searchParams;
  const chain = getChain(await searchParams);

  if (!rawSubject || !rawCap) {
    return <Frame error="Missing parameters. Use ?subject=0x...&capability=kyc.basic" />;
  }

  const cap = capabilities.find(
    (c) => c.id === rawCap || c.hash.toLowerCase() === rawCap.toLowerCase()
  );
  if (!cap) {
    return <Frame error={`Unknown capability "${rawCap}". Available: ${capabilities.map(c => c.id).join(", ")}`} />;
  }

  const casper = isCasperChain(chain);

  // Validate address format for the active chain
  if (!casper && !isAddressLike(rawSubject)) {
    return <Frame error="Invalid subject address. Expected 0x... format." />;
  }
  if (casper && !isCasperAddress(rawSubject)) {
    return <Frame error="Invalid subject. Expected account-hash-... format for Casper." />;
  }

  // Non-live chains can't do on-chain verification.
  if (!chain.live) {
    return (
      <Frame
        subject={rawSubject as Address}
        capabilityId={cap.id}
        capable={false}
        error={`${chain.name} is not yet live.`}
      />
    );
  }

  const subject = rawSubject as Address;
  const capHash: Hex = cap.hash;
  let capable: boolean;
  try {
    capable = casper
      ? await withTimeout(isCapableCasper(subject, capHash))
      : await withTimeout(isCapable(subject, capHash));
  } catch {
    return (
      <Frame
        subject={subject}
        capabilityId={cap.id}
        error="Verification is temporarily unavailable."
      />
    );
  }
  const view = capable
    ? casper
      ? await withTimeout(readCredentialCasper(subject, capHash)).catch(() => null)
      : await withTimeout(readCredential(subject, capHash)).catch(() => null)
    : null;

  return (
    <Frame
      subject={subject}
      capabilityId={cap.id}
      capable={capable}
      issuer={view?.issuer ?? null}
      expiresAt={view?.expiresAt ?? null}
    />
  );
}

function Frame(props: {
  error?: string;
  subject?: Address;
  capabilityId?: string;
  capable?: boolean;
  issuer?: Address | null;
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

  return (
    <a
      href={link}
      target="_top"
      className="block bg-paper px-5 py-4 no-underline"
    >
      <div className="flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        <span>Ligis · verify</span>
        <span className="font-mono tabular">{network.name.toLowerCase()}</span>
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
