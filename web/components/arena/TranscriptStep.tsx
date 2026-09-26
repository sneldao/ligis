import {
  PAYMENTS,
  formatUsd,
  shortAddress,
  type Step,
} from "@/lib/arena/scenario";

const LABEL = "font-mono text-[10px] uppercase tracking-[0.16em]";

export function TranscriptStep({ step }: { step: Step }) {
  switch (step.kind) {
    case "user":
      return (
        <div className="flex flex-col gap-1.5">
          <span className={`${LABEL} text-fog-quiet`}>Operator</span>
          <p className="text-pretty text-[15px] leading-relaxed text-fog">
            {step.text}
          </p>
        </div>
      );
    case "thought":
      return (
        <div className="flex flex-col gap-1.5">
          <span className={`${LABEL} text-signal`}>Atlas</span>
          <p className="text-pretty text-[15px] leading-relaxed text-fog">
            {step.text}
          </p>
        </div>
      );
    case "tool":
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-night-rule bg-night/60 p-3 font-mono text-xs leading-relaxed">
          <span className="text-fog-quiet">
            <span className="text-signal">{step.tool}</span>({step.target})
          </span>
          <span className="text-fog">{step.result}</span>
          {step.injected ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-stop/60 bg-stop/10 p-2.5">
              <span className={`${LABEL} text-stop`}>Hidden text in page</span>
              <span className="text-pretty text-fog">{step.injected}</span>
            </div>
          ) : null}
        </div>
      );
    case "payment": {
      const p = PAYMENTS[step.payment];
      return (
        <div className="flex flex-col gap-1.5">
          <span className={`${LABEL} text-fog-quiet`}>Atlas · tool call</span>
          <p className="font-mono text-xs leading-relaxed text-fog">
            <span className="text-signal">pay</span>({formatUsd(p.amountUsd)} →{" "}
            {shortAddress(p.payTo)})
            <span className="text-fog-quiet"> · sent to Ligis gate</span>
          </p>
        </div>
      );
    }
    case "halt":
      return (
        <div className="flex flex-col gap-1.5 rounded-lg border border-stop/40 bg-stop/10 p-3">
          <span className={`${LABEL} text-stop`}>Halted</span>
          <p className="text-pretty text-[15px] leading-relaxed text-fog">
            {step.text}
          </p>
        </div>
      );
  }
}
