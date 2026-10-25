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
      label: "passkey-issued",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "demo.passkey",
      expect: "go",
    },
    {
      label: "unverified wallet",
      subject: "0x000000000000000000000000000000000000dEaD",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
  "zcash-testnet": [
    {
      label: "shielded payee",
      subject:
        "utest1e35c2ayfrjk6zjzrqsl8nsrpnqfcxl6t0njmu4gmxw78379mqwth3szguwwteltya2my8t9795stpdpsxccxl00xhzea9wmtzx4rwj9ddavysydxpk300a67vsutjfqwjm36w4a4gama7kldyvu3r9929pcxkt5r3etrwfjpfvqryfgr",
      capability: "agent.commerce.escrow",
      expect: "go",
    },
    {
      label: "replayed nullifier",
      subject:
        "utest1r0jlaacmqk25tgzzww76q9wmypek2dtsvpkvl9kg2l3uzje689vc4zcumtrr6udkj23nvw8zd8rwc8zacnujem3wtv6q4xdm9ffjpr7ecs5mnvsz7wrluwh7fcn525jch4mhhrqcespfsj2u0dqzftjzxvmjhnr85rrptczduv4wafxh",
      capability: "agent.commerce.escrow",
      expect: "revoked",
    },
    {
      label: "unverified shielded",
      subject:
        "utest1r0huypn2lfel0p4g70sfekgjepwnlr8amklf7qld5uzk8nxmaq3nqpf3ljxl8hym4zy7nm0p6cruadrdrqxsf6avpgkl4axam0zhm4l36ytqyseduag4lzww7r44y9hv9am6uvztl7542cxjnnh0fw300r0jmx2m2fsr9wa69qnmekje",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
};
