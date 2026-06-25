export type Phase = "BOOT" | "REASON" | "GATE" | "ACT" | "RECORD";

export const PHASES: ReadonlyArray<{ key: Phase; label: string; gloss: string }> = [
  { key: "BOOT", label: "boot", gloss: "ensure the agent token exists" },
  { key: "REASON", label: "reason", gloss: "map the goal to required capabilities" },
  { key: "GATE", label: "gate", gloss: "check the credentials registry for each one" },
  { key: "ACT", label: "act", gloss: "self-issue any that are missing" },
  { key: "RECORD", label: "record", gloss: "anchor the manifest on-chain" },
];

export type StewardEvent =
  | { type: "phase"; phase: Phase; status: "start" | "done" | "skip" }
  | { type: "boot"; phase: "BOOT"; tokenId: string; minted: boolean }
  | { type: "delta"; phase: "REASON"; text: string }
  | { type: "capability"; phase: "GATE"; name: string; hash: string; capable: boolean; selfIssued: boolean; issueTxHash?: string }
  | { type: "tx"; phase: "ACT"; name: string; txHash: string }
  | {
      type: "manifest";
      phase: "RECORD";
      rootHash: string;
      anchorTx: string;
      storageType: "0g" | "local";
      tokenUri: string;
    }
  | { type: "summary"; ok: boolean; tokenId?: string; gated?: boolean; live: boolean; rpcCalls?: number }
  | { type: "error"; message: string };
