/**
 * Named situations that cast a visitor into a role before showing the gate.
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
  /** Registry capability the situation maps to */
  capability: string;
  /** Named stack / integrator, not "agents in general" */
  integrator: string;
};

export const SITUATIONS: readonly Situation[] = [
  {
    id: "treasury",
    role: "Treasury / spend agent",
    check: "My software pays wallets it hasn't met",
    moment: "About to send USDC to an unknown seller for data or a job",
    without: "Blind send — funds gone, no prior check, no shareable reason",
    withLigis: "STOP unless the seller holds the required capability",
    capability: "kyc.basic",
    integrator: "x402 buyers · CROO spend",
  },
  {
    id: "merchant",
    role: "Merchant / paid API",
    check: "I expose a paid API and anyone with money can call it",
    moment: "An agent hits your endpoint ready to pay",
    without: "Pay-only spam — bots that can pay but shouldn't be customers",
    withLigis: "401 without a credential, then 402 — pay only if allowed",
    capability: "kyc.basic",
    integrator: "x402 resource servers",
  },
  {
    id: "escrow",
    role: "Hire / escrow flow",
    check: "Agent A hires Agent B without a human in the loop",
    moment: "Opening escrow or releasing a job to a seller wallet",
    without: "Wallet ≠ permission — dispute with no prior eligibility check",
    withLigis: "GO only if the seller holds agent.commerce.escrow",
    capability: "agent.commerce.escrow",
    integrator: "GenLayer JobEscrow · commerce agents",
  },
  {
    id: "compliance",
    role: "Risk / compliance agent",
    check: "I allocate capital and need a yes/no before it moves",
    moment: "Mandate or treasury about to fund a counterparty",
    without: "Heuristics and hope — no machine-readable authorization",
    withLigis: "Pass/fail from on-chain credentials the instant before spend",
    capability: "rwa.accredited",
    integrator: "orchestrators · mandate routers",
  },
  {
    id: "operator",
    role: "Human operator",
    check: "I review autonomous spends and need an audit trail",
    moment: "Someone asks why the agent paid — or why it didn't",
    without: "A log line and a shrug",
    withLigis: "A shareable gate link that re-runs the same on-chain read",
    capability: "kyc.basic",
    integrator: "ops · audit · support",
  },
] as const;

export function getSituation(id: string | undefined): Situation | undefined {
  if (!id) return undefined;
  return SITUATIONS.find((s) => s.id === id);
}
