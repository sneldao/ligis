/**
 * Named /gate samples used by the page UI and by `scripts/smoke-demo-credentials.ts`.
 * Expectations are what a live on-chain read must return — keep them honest.
 */
export type DemoGateSample = {
  label: string;
  subject: string;
  /** Capability id for the sample link (defaults to kyc.basic in the form). */
  capability: string;
  /** Expected gate outcome for CI. */
  expect: "go" | "revoked" | "none";
};

export const DEMO_GATE_SAMPLES: Record<string, DemoGateSample[]> = {
  "casper-testnet": [
    {
      label: "verified agent",
      subject:
        "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326",
      capability: "kyc.basic",
      expect: "go",
    },
    {
      label: "unverified wallet",
      subject:
        "account-hash-0000000000000000000000000000000000000000000000000000000000000001",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
  "pharos-atlantic": [
    {
      label: "verified agent",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "kyc.basic",
      expect: "go",
    },
    {
      label: "unverified wallet",
      subject: "0x000000000000000000000000000000000000dEaD",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
  "monad-testnet": [
    {
      label: "verified agent",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "agent.commerce.escrow",
      expect: "go",
    },
    {
      label: "revoked credential",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "demo.metropolis.revocation",
      expect: "revoked",
    },
    {
      label: "unverified wallet",
      subject: "0x000000000000000000000000000000000000dEaD",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
};
