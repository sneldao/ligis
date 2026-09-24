import { useMemo } from "react";
import type { State } from "./state";
import { PhaseCommand } from "./PhaseCommand";

export function StewardDeveloperChrome({
  state,
  showReal,
  showEvents,
  setShowReal,
  setShowEvents,
}: {
  state: State;
  showReal: boolean;
  showEvents: boolean;
  setShowReal: (updater: (v: boolean) => boolean) => void;
  setShowEvents: (updater: (v: boolean) => boolean) => void;
}) {
  const eventCount = state.events.length;
  const jsonPanel = useMemo(
    () => JSON.stringify(state.events, null, 2),
    [state.events],
  );

  return (
    <section className="space-y-6 border-t border-rule pt-8">
      <p className="eyebrow text-ink-quiet">for developers</p>

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShowReal((v) => !v)}
          className="eyebrow flex items-baseline gap-3 text-ink-soft transition-colors hover:text-ink"
        >
          <span>{showReal ? "▾" : "▸"}</span>
          <span>Real CLI commands</span>
        </button>
        {showReal ? (
          <div className="space-y-5">
            <PhaseCommand
              index={1}
              label="boot"
              command={`PRIVATE_KEY=0x... ligis issue --token-uri "ipfs://my-agent"`}
              note="Mints a PharosAgentID to the signer's wallet. Returns tokenId."
            />
            <PhaseCommand
              index={2}
              label="reason"
              command={`ligis agent run --goal "Operate as a Pharos agent…" --dry-run`}
              note="Sends the goal to 0G Compute (TEE-verified LLM). Returns the required capability list."
            />
            <PhaseCommand
              index={3}
              label="gate"
              command={`ligis verify --subject 0x... --capability "agent.commerce.escrow"`}
              note="Reads isCapable from CredentialRegistry. Returns capable: true/false."
            />
            <PhaseCommand
              index={4}
              label="act"
              command={`ligis sign --issuer-key 0x... --subject 0x... --capability "agent.commerce.escrow" --expires-in 15552000`}
              note="Signs an EIP-712 credential off-chain, then submits it on-chain via cast send."
            />
            <PhaseCommand
              index={5}
              label="record"
              command={`ligis agent run --goal "Operate as a Pharos agent…"`}
              note="Full loop: boot → reason → gate → act → record. Requires PRIVATE_KEY + ZEROG_PRIVATE_KEY."
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShowEvents((v) => !v)}
          className="eyebrow flex items-baseline gap-3 text-ink-soft transition-colors hover:text-ink"
        >
          <span>{showEvents ? "▾" : "▸"}</span>
          <span>Raw event stream</span>
          {eventCount > 0 ? (
            <span className="font-mono text-xs tabular text-ink-quiet">
              {eventCount} events
            </span>
          ) : null}
        </button>
        {showEvents ? (
          <pre className="max-h-72 overflow-auto bg-paper-deep px-5 py-4 font-mono text-xs leading-relaxed tabular text-ink">
            {eventCount === 0
              ? "// Run the loop to populate the stream."
              : jsonPanel}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
