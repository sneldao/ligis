/**
 * Named situations that cast a visitor into a role before showing the gate.
 *
 * Copy here uses user-language from docs/positioning.md: payee, amount,
 * scope, "verified payee". Internal terms (subject, capability, issuer)
 * stay in capability / page-level code, not in user-facing prose.
 *
 * Capability ids must exist in assets/credentials — unknown ids break the live demo.
 */

export type Situation = {
  id: string;
  /** Short role label — left column of the cast table */
  role: string;
  /** "This is you if…" checkbox copy */
  check: string;
  /** The dangerous moment, in plain language */
  moment: string;
  /** What goes wrong without the gate */
  without: string;
  /** What happens with the gate */
  withLigis: string;
  /** Registry capability the situation maps to (internal id; never in copy) */
  capability: string;
  /** Named stack / integrator, not "agents in general" */
  integrator: string;
};

/**
 * Default set shown on first paint. The full set stays reachable via
 * `?moment=<id>` so demos and the operator / compliance / escrow flows
 * still resolve, just not by default. Keep this list short — long
 * "Also" rows pull the visitor away from the gate.
 */
export const DEFAULT_SITUATION_IDS = ["treasury", "merchant"] as const;

export const SITUATIONS: readonly Situation[] = [
  {
    id: "treasury",
    role: "Agent owner",
    check: "My software pays wallets it hasn't met",
    moment: "About to send USDC to an unknown seller for data or a job",
    without:
      "Blind send — funds gone, no payee check, no scope check, no shareable reason",
    withLigis:
      "STOP unless the payee matches the job; GO when it does — with a receipt",
    capability: "kyc.basic",
    integrator: "x402 buyers · CROO spend",
  },
  {
    id: "merchant",
    role: "Merchant",
    check: "I expose a paid API and anyone with money can call it",
    moment: "An agent hits your endpoint ready to pay",
    without: "Pay-only spam — bots that can pay but shouldn't be customers",
    withLigis:
      "401 if the payee is wrong, 402 if the amount is off, 200 when both match the offer",
    capability: "kyc.basic",
    integrator: "x402 resource servers",
  },
  {
    id: "escrow",
    role: "Hire / escrow",
    check: "Agent A hires Agent B without a human in the loop",
    moment: "Opening escrow or releasing a job to a seller wallet",
    without: "Wallet ≠ permission — dispute with no prior payee or scope check",
    withLigis:
      "GO only if the payee matches the scope; STOP otherwise, with the reason",
    capability: "agent.commerce.escrow",
    integrator: "GenLayer JobEscrow · commerce agents",
  },
  {
    id: "compliance",
    role: "Risk / compliance",
    check: "I allocate capital and need a yes/no before it moves",
    moment: "Mandate or treasury about to fund a counterparty",
    without: "Heuristics and hope — no machine-readable authorization",
    withLigis: "GO/STOP on payee, amount, and scope — one read, signed receipt",
    capability: "rwa.accredited",
    integrator: "orchestrators · mandate routers",
  },
  {
    id: "operator",
    role: "Human operator",
    check: "I review autonomous spends and need an audit trail",
    moment: "Someone asks why the agent paid — or why it didn't",
    without: "A log line and a shrug",
    withLigis:
      "A shareable gate link that re-runs the same payee / amount / scope read",
    capability: "kyc.basic",
    integrator: "ops · audit · support",
  },
] as const;

export function getSituation(id: string | undefined): Situation | undefined {
  if (!id) return undefined;
  return SITUATIONS.find((s) => s.id === id);
}

/**
 * The default cast shown on first paint. Other situations remain reachable
 * by query string (`?moment=escrow|compliance|operator`) on the page that
 * consumes this list, so the gate and the developer disclosure both keep
 * their full surface area while the landing stays focused.
 */
export function defaultSituations(): readonly Situation[] {
  return DEFAULT_SITUATION_IDS.flatMap(
    (id) => SITUATIONS.find((s) => s.id === id) ?? [],
  );
}
