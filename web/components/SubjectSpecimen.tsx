import { AgentPortrait } from "@/components/AgentPortrait";
import { truncateAddress } from "@/lib/format";
import { specimenAddress } from "@/lib/specimen";

export type SpecimenState = "idle" | "reading" | "go" | "stop";

/**
 * The subject of a payment, drawn as a Field specimen. The same wallet
 * always gets the same face, so the counterparty feels like someone
 * rather than a hex string. The plate develops like a print, scans while
 * the chain is read, then takes a GO/STOP stamp.
 */
export function SubjectSpecimen({
  subject,
  state = "idle",
  size = "md",
  caption = true,
}: {
  subject: string;
  state?: SpecimenState;
  size?: "chip" | "md";
  caption?: boolean;
}) {
  const address = specimenAddress(subject);
  const stamped = state === "go" || state === "stop";

  if (size === "chip") {
    return (
      <span className="specimen-chip" data-state={state} aria-hidden>
        {address ? (
          <AgentPortrait
            key={address}
            address={address}
            className="specimen-art"
          />
        ) : null}
      </span>
    );
  }

  return (
    <figure className="specimen w-28 shrink-0 sm:w-36" data-state={state}>
      <div className="specimen-plate">
        {address ? (
          <AgentPortrait
            key={address}
            address={address}
            className="specimen-art block h-full w-full"
          />
        ) : (
          <span className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
            no subject
          </span>
        )}
        <span className="specimen-scan" aria-hidden />
        {stamped ? (
          <span className="specimen-stamp" aria-hidden>
            {state === "go" ? "GO" : "STOP"}
          </span>
        ) : null}
      </div>
      {caption ? (
        <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
          {state === "reading" ? "reading chain" : "specimen"}
          {subject.trim() ? (
            <span className="mt-0.5 block normal-case tracking-normal tabular text-ink-soft">
              {truncateAddress(subject.trim(), 6, 4)}
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
