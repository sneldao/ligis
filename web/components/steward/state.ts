import type { Phase, StewardEvent } from "@/lib/steward-events";

export type PhaseStatus = "idle" | "running" | "done" | "error";

export type State = {
  phaseStatus: Record<Phase, PhaseStatus>;
  reasonText: string;
  reasonModel?: string;
  reasonVerified?: boolean;
  reasonSource?: "0g" | "local";
  capabilities: Array<{
    name: string;
    capable: boolean;
    selfIssued: boolean;
    issueTxHash?: string;
  }>;
  txs: Array<{ name: string; txHash: string }>;
  manifest: {
    rootHash: string;
    anchorTx: string;
    storageType: string;
    tokenUri: string;
    storageTxHash?: string;
  } | null;
  summary: {
    ok: boolean;
    tokenId?: string;
    gated?: boolean;
    live: boolean;
    rpcCalls?: number;
    subject?: string;
    minted?: boolean;
    model?: string;
    source?: "0g" | "local";
  } | null;
  error: string | null;
  events: StewardEvent[];
};

export const EMPTY: State = {
  phaseStatus: {
    BOOT: "idle",
    REASON: "idle",
    GATE: "idle",
    ACT: "idle",
    RECORD: "idle",
  },
  reasonText: "",
  capabilities: [],
  txs: [],
  manifest: null,
  summary: null,
  error: null,
  events: [],
};

export function apply(state: State, ev: StewardEvent): State {
  const next: State = {
    ...state,
    events: [...state.events, ev],
  };
  switch (ev.type) {
    case "phase":
      next.phaseStatus = {
        ...state.phaseStatus,
        [ev.phase]: ev.status === "start" ? "running" : ev.status,
      };
      break;
    case "boot":
      next.summary = {
        ok: true,
        tokenId: ev.tokenId,
        live: false,
        subject: ev.subject,
        minted: ev.minted,
      };
      break;
    case "delta":
      next.reasonText = state.reasonText + ev.text;
      next.reasonModel = ev.model;
      next.reasonVerified = ev.verified;
      next.reasonSource = ev.source;
      break;
    case "capability": {
      const existing = state.capabilities.findIndex((c) => c.name === ev.name);
      const entry = {
        name: ev.name,
        capable: ev.capable,
        selfIssued: ev.selfIssued,
        issueTxHash: ev.issueTxHash,
      };
      if (existing >= 0) {
        next.capabilities = state.capabilities.map((c, i) =>
          i === existing ? entry : c,
        );
      } else {
        next.capabilities = [...state.capabilities, entry];
      }
      break;
    }
    case "tx":
      next.txs = [...state.txs, { name: ev.name, txHash: ev.txHash }];
      break;
    case "manifest":
      next.manifest = {
        rootHash: ev.rootHash,
        anchorTx: ev.anchorTx,
        storageType: ev.storageType,
        tokenUri: ev.tokenUri,
        storageTxHash: ev.storageTxHash,
      };
      break;
    case "summary":
      next.summary = {
        ok: ev.ok,
        tokenId: ev.tokenId,
        gated: ev.gated,
        live: ev.live,
        rpcCalls: ev.rpcCalls,
        subject: ev.subject,
        minted: next.summary?.minted,
        model: ev.model,
        source: ev.source,
      };
      break;
    case "error":
      next.error = ev.message;
      break;
  }
  return next;
}

export function readinessOf(state: State): number {
  const ps = state.phaseStatus;
  if (ps.RECORD === "done") return 100;
  if (ps.RECORD === "running") return 90;
  if (ps.ACT === "done") return 85;
  if (ps.ACT === "running") return 75;
  if (ps.GATE === "done") {
    const held = state.capabilities.filter((c) => c.capable).length;
    const total = state.capabilities.length || 1;
    return 35 + Math.round((held / total) * 35);
  }
  if (ps.GATE === "running") return 35;
  if (ps.REASON === "done") return 25;
  if (ps.REASON === "running") return 15;
  if (ps.BOOT === "done") return 10;
  if (ps.BOOT === "running") return 5;
  return 0;
}

export function thoughtOf(state: State): string {
  const ps = state.phaseStatus;
  const caps = state.capabilities;
  const held = caps.filter((c) => c.capable).map((c) => c.name);
  const missing = caps.filter((c) => !c.capable).map((c) => c.name);
  const tokenId = state.summary?.tokenId;

  for (const phase of ["RECORD", "ACT", "GATE", "REASON", "BOOT"] as const) {
    const s = ps[phase];
    if (s === "running" || s === "done") {
      if (phase === "BOOT") {
        if (s === "running")
          return "Searching the registry for my agent token…";
        return tokenId
          ? `I'm token #${tokenId}. I exist on-chain. Now — what am I for?`
          : "I exist on-chain. Now — what am I for?";
      }
      if (phase === "REASON") {
        if (s === "running")
          return "Sending my goal to 0G Compute. What capabilities does this require?";
        return caps.length > 0
          ? `I need ${caps.map((c) => c.name.split(".").pop()).join(" and ")}. Let me check what I already hold.`
          : "I know what I need. Let me check what I already hold.";
      }
      if (phase === "GATE") {
        if (s === "running")
          return "Checking the credential registry — what do I have, what's missing?";
        if (missing.length === 0) return "I hold everything I need. I'm ready.";
        const heldShort = held.map((n) => n.split(".").pop());
        const missingShort = missing.map((n) => n.split(".").pop());
        return `I hold ${held.length > 0 ? heldShort.join(", ") : "nothing"}, but ${missingShort.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing. I know what I need.`;
      }
      if (phase === "ACT") {
        if (s === "running")
          return "Self-issuing the missing credential. I don't need permission — I'm authorized.";
        return "Credential issued and on-chain. I have everything I need.";
      }
      if (phase === "RECORD") {
        if (s === "running")
          return "Writing my evidence manifest to 0G Storage — goal, reasoning, every tx hash.";
        return "I know who I am, what I can do, and I can prove both.";
      }
    }
  }
  return "I exist, but I don't know who I am yet.";
}
