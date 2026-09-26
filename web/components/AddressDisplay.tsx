import { network } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";
import { CopyButton } from "./CopyButton";

type Variant = "inline" | "block";

import { SubjectSpecimen } from "@/components/SubjectSpecimen";

export function AddressDisplay({
  address,
  variant = "inline",
  link = true,
  copy = true,
  head,
  tail,
}: {
  address: string;
  variant?: Variant;
  link?: boolean;
  copy?: boolean;
  head?: number;
  tail?: number;
}) {
  const display = truncateAddress(address, head, tail);
  const explorer = `${network.explorerUrl}/address/${address}`;

  const body = link ? (
    <a
      href={explorer}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra tabular"
    >
      {display}
    </a>
  ) : (
    <span className="font-mono text-ink tabular">{display}</span>
  );

  if (variant === "block") {
    return (
      <div className="flex items-baseline justify-between gap-6">
        <span className="inline-flex items-baseline gap-2">
          <SubjectSpecimen subject={address} size="chip" />
          {body}
        </span>
        {copy ? <CopyButton value={address} /> : null}
      </div>
    );
  }

  return (
    <span className="inline-flex items-baseline gap-3">
      <span className="inline-flex items-baseline gap-2">
        <SubjectSpecimen subject={address} size="chip" />
        {body}
      </span>
      {copy ? <CopyButton value={address} /> : null}
    </span>
  );
}
