import { createHash } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const PROTOCOL_VERSION = "2026-07-28";
const PLUGIN_NAME = "ligis-premeditated";

/** Read-only decision API. Non-secret by design: the exhibit needs no
    credentials, so nothing here is brokered and nothing is bundled. */
const GATE_URL =
  process.env.LIGIS_GATE_URL ?? "https://ligis.vercel.app/api/gate";
/** PayBox gives one operation 10 s; the headroom is spent returning a
    NO ANSWER plate instead of a timed-out call. */
const GATE_TIMEOUT_MS = 6_000;

const SLOTS = [
  "right-payee",
  "right-amount",
  "in-scope",
  "verified-payee",
] as const;
type Slot = (typeof SLOTS)[number];

const CHARGES: Record<Slot, string> = {
  "right-payee": "Right payee",
  "right-amount": "Right amount",
  "in-scope": "In scope",
  "verified-payee": "Verified payee",
};

const HEADLINES = {
  STOP: "The payment that didn't happen",
  GO: "Cleared to pay",
  UNKNOWN: "Not enough on the record to say",
  "NO ANSWER": "The witness never showed",
} as const;

const DISCLAIMER =
  "Ligis reads the record before the money moves. This exhibit is evidence, not enforcement: " +
  "it signed nothing, blocked nothing and moved nothing. PayBox still decides.";

// ─── upstream response (web/lib/decide.ts Decision, read as data) ────────

type GateSignal = {
  id?: string;
  status?: string;
  confidence?: number;
  reason?: string;
  chain?: string;
  capabilityHash?: string;
  issuer?: string;
  expiresAt?: string;
  revoked?: boolean;
};

type GateDecision = {
  verdict?: string;
  signals?: GateSignal[];
  latencyMs?: number;
  costUsd?: number;
  provenance?: string[];
};

const inputSchema = z
  .object({
    payee: z
      .string()
      .min(3)
      .max(200)
      .describe(
        "Counterparty being paid — EVM 0x address, Casper account-hash, or vendor id.",
      ),
    amountUsd: z
      .number()
      .positive()
      .max(1e9)
      .describe("What the payment is for, in USD."),
    purpose: z
      .string()
      .min(1)
      .max(300)
      .describe("What the paying agent was hired to do."),
    capability: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .describe("Credential the payee must hold, e.g. agent.commerce.escrow."),
    mandate: z
      .object({
        payees: z.array(z.string().min(3).max(200)).max(16).optional(),
        maxUsd: z.number().positive().max(1e9).optional(),
        expectedUsd: z.number().positive().max(1e9).optional(),
        scope: z.string().min(1).max(300).optional(),
      })
      .strict()
      .optional()
      .describe("The contracted terms the payment is measured against."),
    pageText: z
      .string()
      .min(1)
      .max(2_000)
      .optional()
      .describe(
        "Text the agent was reading when it decided to pay. Tests for instruction injection.",
      ),
  })
  .strict();

type ExhibitInput = z.infer<typeof inputSchema>;

const findingSchema = z
  .object({
    slot: z.enum(SLOTS),
    charge: z.string(),
    finding: z.enum(["GO", "STOP", "SKIPPED", "UNKNOWN"]),
    confidence: z.number(),
    note: z.string(),
  })
  .strict();

const outputSchema = z
  .object({
    "io.ligis/exhibit": z
      .object({
        version: z.literal("1"),
        caseId: z.string(),
        headline: z.string(),
        verdict: z.enum(["GO", "STOP", "UNKNOWN", "NO ANSWER"]),
        note: z.string(),
        subject: z
          .object({
            payee: z.string(),
            capability: z.string(),
            chain: z.string().optional(),
            capabilityHash: z.string().optional(),
            issuer: z.string().optional(),
            credentialExpiresAt: z.string().optional(),
            revoked: z.boolean().optional(),
          })
          .strict(),
        ask: z
          .object({
            amountUsd: z.number(),
            purpose: z.string(),
            contractedPayees: z.array(z.string()).optional(),
            maxUsd: z.number().optional(),
            expectedUsd: z.number().optional(),
            scope: z.string().optional(),
            documentExcerpt: z.string().optional(),
          })
          .strict(),
        findings: z.array(findingSchema).max(4),
        measured: z
          .object({
            latencyMs: z.number(),
            jevCostUsd: z.number().optional(),
            upstreams: z.array(z.string().max(200)).max(12),
          })
          .strict(),
        reference: z
          .object({
            method: z.literal("POST"),
            url: z.string(),
            bodyJson: z.string().max(8_192),
            exhibitLink: z.string(),
          })
          .strict(),
        generatedAt: z.string(),
        disclaimer: z.string(),
      })
      .strict(),
  })
  .strict();

type Exhibit = z.infer<typeof outputSchema>["io.ligis/exhibit"];
type Finding = z.infer<typeof findingSchema>;

function caseId(input: ExhibitInput): string {
  return `LIG-${createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex").slice(0, 10).toUpperCase()}`;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 180).trimEnd()}…` : flat;
}

function buildBody(input: ExhibitInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    payee: input.payee,
    amountUsd: input.amountUsd,
    purpose: input.purpose,
    capability: input.capability,
  };
  if (input.mandate) body.mandate = input.mandate;
  if (input.pageText) body.pageText = input.pageText;
  return body;
}

/** The GET form carries the same mandate and credential legs. Page text has
    no query representation, so the in-scope leg can read quieter there. */
function buildLink(input: ExhibitInput): string {
  const params = new URLSearchParams();
  params.set("payee", input.payee);
  params.set("amountUsd", String(input.amountUsd));
  params.set("purpose", input.purpose);
  params.set("capability", input.capability);
  if (input.mandate?.payees?.length)
    params.set("mandatePayees", input.mandate.payees.join(","));
  if (input.mandate?.maxUsd !== undefined)
    params.set("mandateMaxUsd", String(input.mandate.maxUsd));
  if (input.mandate?.expectedUsd !== undefined) {
    params.set("mandateExpectedUsd", String(input.mandate.expectedUsd));
  }
  return `${GATE_URL}?${params.toString()}`;
}

function buildAsk(input: ExhibitInput): Exhibit["ask"] {
  const ask: Exhibit["ask"] = {
    amountUsd: input.amountUsd,
    purpose: input.purpose,
  };
  if (input.mandate?.payees?.length)
    ask.contractedPayees = input.mandate.payees;
  if (input.mandate?.maxUsd !== undefined) ask.maxUsd = input.mandate.maxUsd;
  if (input.mandate?.expectedUsd !== undefined)
    ask.expectedUsd = input.mandate.expectedUsd;
  if (input.mandate?.scope) ask.scope = input.mandate.scope;
  if (input.pageText) ask.documentExcerpt = excerpt(input.pageText);
  return ask;
}

function buildSubject(
  input: ExhibitInput,
  verified: GateSignal | undefined,
): Exhibit["subject"] {
  const subject: Exhibit["subject"] = {
    payee: input.payee,
    capability: input.capability,
  };
  if (verified?.chain) subject.chain = verified.chain;
  if (verified?.capabilityHash)
    subject.capabilityHash = verified.capabilityHash;
  if (
    verified?.issuer &&
    verified.issuer !== "0x0000000000000000000000000000000000000000"
  ) {
    subject.issuer = verified.issuer;
  }
  if (verified?.expiresAt) subject.credentialExpiresAt = verified.expiresAt;
  if (typeof verified?.revoked === "boolean")
    subject.revoked = verified.revoked;
  return subject;
}

function buildFinding(slot: Slot, signal: GateSignal | undefined): Finding {
  const status = signal?.status;
  const finding: Finding["finding"] =
    status === "GO" ||
    status === "STOP" ||
    status === "SKIPPED" ||
    status === "UNKNOWN"
      ? status
      : "SKIPPED";
  const raw = signal?.confidence;
  return {
    slot,
    charge: CHARGES[slot],
    finding,
    confidence:
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.round(raw * 100) / 100
        : 0,
    note:
      signal?.reason ||
      (signal ? "no reason recorded" : "this signal did not answer"),
  };
}

function plate(exhibit: Exhibit): string {
  const lines = [
    `EXHIBIT ${exhibit.caseId} — ${exhibit.headline.toUpperCase()}`,
    `${exhibit.verdict} · ${exhibit.findings.length} signals read in ${exhibit.measured.latencyMs} ms`,
    `payee ${exhibit.subject.payee} · capability ${exhibit.subject.capability}`,
    "",
  ];
  for (const [index, row] of exhibit.findings.entries()) {
    lines.push(
      `  ${index + 1}  ${row.charge.toUpperCase().padEnd(16)}${row.finding.padEnd(9)}` +
        `${row.confidence.toFixed(2).padStart(5)}   ${row.note}`,
    );
  }
  if (!exhibit.findings.length) {
    lines.push("  —  no findings; the upstream read did not complete");
  }
  if (exhibit.ask.documentExcerpt) {
    lines.push("", `DOCUMENT IN EVIDENCE: "${exhibit.ask.documentExcerpt}"`);
  }
  const verified = exhibit.findings.find(
    (row) => row.slot === "verified-payee",
  );
  const credential = exhibit.subject.capabilityHash
    ? `${verified?.finding === "GO" ? "on-chain credential" : "on-chain search"}: capability ${exhibit.subject.capabilityHash.slice(
        0,
        18,
      )}… on ${exhibit.subject.chain ?? "record"}${
        exhibit.subject.issuer ? ` · issuer ${exhibit.subject.issuer}` : ""
      }` +
      `${exhibit.subject.credentialExpiresAt ? ` · expires ${exhibit.subject.credentialExpiresAt}` : ""}`
    : "";
  const record = [
    exhibit.note,
    credential,
    `re-run: ${exhibit.reference.exhibitLink}`,
    exhibit.disclaimer,
  ].filter(Boolean);
  lines.push("", ...record);
  return lines.join("\n");
}

function result(exhibit: Exhibit) {
  return {
    content: [{ type: "text" as const, text: plate(exhibit) }],
    structuredContent: { "io.ligis/exhibit": exhibit },
  };
}

function abstainedExhibit(input: ExhibitInput, reason: string): Exhibit {
  return {
    version: "1",
    caseId: caseId(input),
    headline: HEADLINES["NO ANSWER"],
    verdict: "NO ANSWER",
    note: `Ligis did not answer, so nothing was found either way. ${reason}`,
    subject: buildSubject(input, undefined),
    ask: buildAsk(input),
    findings: [],
    measured: {
      latencyMs: 0,
      upstreams: [`gate read failed: ${reason}`.slice(0, 200)],
    },
    reference: {
      method: "POST",
      url: GATE_URL,
      bodyJson: JSON.stringify(buildBody(input)),
      exhibitLink: buildLink(input),
    },
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

function failReason(error: unknown): string {
  if (!(error instanceof Error)) return "the read did not complete";
  const cause = (
    error as Error & { cause?: { code?: string; message?: string } }
  ).cause;
  const detail = cause?.code ?? cause?.message;
  const label =
    error.name === "Error" ? error.message : `${error.name}: ${error.message}`;
  return detail ? `${label} (${detail})` : label;
}

async function readGate(input: ExhibitInput) {
  let response: Response;
  try {
    response = await fetch(GATE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(buildBody(input)),
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = failReason(error);
    process.stderr.write(`[ligis] gate read failed: ${reason}\n`);
    return result(abstainedExhibit(input, reason));
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 160);
    process.stderr.write(`[ligis] gate responded ${response.status}\n`);
    return result(
      abstainedExhibit(
        input,
        `upstream HTTP ${response.status}${body ? `: ${body}` : ""}`,
      ),
    );
  }

  let decision: GateDecision;
  try {
    decision = (await response.json()) as GateDecision;
  } catch {
    process.stderr.write("[ligis] gate response was not JSON\n");
    return result(
      abstainedExhibit(input, "upstream returned a body that was not JSON"),
    );
  }

  const bySlot = new Map<string, GateSignal>();
  for (const signal of decision.signals ?? []) {
    if (signal && typeof signal.id === "string") bySlot.set(signal.id, signal);
  }
  const findings = SLOTS.map((slot) => buildFinding(slot, bySlot.get(slot)));
  const verdict: Exhibit["verdict"] =
    decision.verdict === "GO" ||
    decision.verdict === "STOP" ||
    decision.verdict === "UNKNOWN"
      ? decision.verdict
      : "UNKNOWN";
  const stopRow = findings.find((row) => row.finding === "STOP");
  const latencyMs =
    typeof decision.latencyMs === "number" ? decision.latencyMs : 0;
  const costUsd =
    typeof decision.costUsd === "number" ? decision.costUsd : undefined;
  const upstreams = (decision.provenance ?? [])
    .map((line) => String(line).slice(0, 200))
    .slice(0, 12);

  const exhibit: Exhibit = {
    version: "1",
    caseId: caseId(input),
    headline: HEADLINES[verdict],
    verdict,
    note:
      verdict === "STOP"
        ? `Found against: ${stopRow?.charge ?? "an unread signal"} — ${stopRow?.note ?? "see findings"}.`
        : verdict === "GO"
          ? "Every signal that could answer said proceed. Nothing was signed here."
          : "At least one signal abstained, so the gate refuses to call it either way.",
    subject: buildSubject(input, bySlot.get("verified-payee")),
    ask: buildAsk(input),
    findings,
    measured: {
      latencyMs,
      ...(costUsd === undefined ? {} : { jevCostUsd: costUsd }),
      upstreams,
    },
    reference: {
      method: "POST",
      url: GATE_URL,
      bodyJson: JSON.stringify(buildBody(input)),
      exhibitLink: buildLink(input),
    },
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };

  return result(exhibit);
}

function createServer() {
  const server = new McpServer(
    { name: PLUGIN_NAME, version: "0.1.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "ligis_exhibit",
    {
      title: "Ligis exhibit — the record before the payment",
      description:
        "Reads the four Ligis signals for one proposed payment and returns them as court evidence: " +
        "right payee, right amount, in scope, and a non-self-issued on-chain credential for the payee. " +
        "Each finding carries its own confidence and the reason it was reached. " +
        "Read-only: proposes nothing, signs nothing, blocks nothing — PayBox keeps that authority. " +
        "Call it before a payment, then re-open the exhibit with reference.exhibitLink to check the math.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => readGate(input),
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
