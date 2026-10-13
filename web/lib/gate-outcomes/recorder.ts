import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { authenticateOutcomeCaller, type CallerGrant } from "./auth";
import { RECORD_TTL_SECONDS, type OutcomeBackend } from "./backend";
import { type ProofVerifier } from "./proof";
import {
  ADDRESS,
  UUID,
  validDecisionInput,
  parseOutcomeSubmission,
  type DecisionRecord,
  type Outcome,
  type OutcomeSubmission,
} from "./schema";

type Result =
  | {
      stored: true;
      decisionId: string;
      duplicate?: boolean;
      outcome?: Outcome;
      expiresAt?: number;
    }
  | { stored: false; reason: string; status: number };
const denied = (reason: string, status: number): Result => ({
  stored: false,
  reason,
  status,
});

export class OutcomeRecorder {
  constructor(
    private options: {
      enabled: boolean;
      backend: OutcomeBackend;
      grants: CallerGrant[];
      hashKey: string;
      verifier?: ProofVerifier;
      now?: () => number;
    },
  ) {
    if (options.hashKey.length < 32) throw Error("invalid-hash-key");
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private hash(domain: string, value: unknown): string {
    return createHmac("sha256", this.options.hashKey)
      .update(JSON.stringify([domain, value]))
      .digest("hex");
  }
  private tenant(headers: Headers) {
    const grant = authenticateOutcomeCaller(headers, this.options.grants);
    return grant ? this.hash("tenant", grant.tenant) : null;
  }
  /** Call only AFTER the server has computed the decision. No HTTP creation
   * endpoint accepts client-supplied verdicts. Public GET/embed never qualify. */
  async recordDecision(
    input: unknown,
    request: { method: string; headers: Headers },
  ): Promise<Result> {
    if (!this.options.enabled || request.method !== "POST")
      return denied("disabled", 404);
    const tenantHash = this.tenant(request.headers);
    if (!tenantHash) return denied("unauthorized", 401);
    if (!validDecisionInput(input)) return denied("invalid-decision", 400);
    const now = this.now();
    const record: DecisionRecord = {
      schemaVersion: 1,
      id: randomUUID(),
      tenantHash,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + RECORD_TTL_SECONDS * 1000,
      policyVersion: input.policyVersion,
      evidenceVersion: input.evidenceVersion,
      verdict: input.verdict,
      // Projection is important: never spread request/intent objects into storage.
      sources: Object.fromEntries(Object.entries(input.sources)),
      contextBinding: this.hash("context", [
        tenantHash,
        input.context.payee.toLowerCase(),
        input.context.amountUsd,
        input.context.capability ?? null,
        input.settlement
          ? [
              input.settlement.chainId,
              input.settlement.asset.toLowerCase(),
              input.settlement.payer.toLowerCase(),
              input.settlement.payee.toLowerCase(),
              input.settlement.amountBaseUnits,
            ]
          : null,
      ]),
      reports: {},
    };
    if (input.settlement) {
      record.settlement = {
        chainId: input.settlement.chainId,
        assetHash: this.hash("address", [
          tenantHash,
          input.settlement.asset.toLowerCase(),
        ]),
        payerHash: this.hash("address", [
          tenantHash,
          input.settlement.payer.toLowerCase(),
        ]),
        payeeHash: this.hash("address", [
          tenantHash,
          input.settlement.payee.toLowerCase(),
        ]),
        amountBaseUnits: input.settlement.amountBaseUnits,
      };
    }
    try {
      if (!(await this.options.backend.admit(tenantHash)))
        return denied("attempt-limit", 429);
      const result = await this.options.backend.atomic({
        record,
        expected: null,
      });
      if (result !== "stored")
        return denied(result, result === "limited" ? 429 : 409);
      return {
        stored: true,
        decisionId: record.id,
        expiresAt: record.expiresAt,
      };
    } catch {
      // An uncertain storage result is never advertised as stored. Risk decision
      // is neither accepted nor changed by this function.
      return denied("storage-unavailable", 503);
    }
  }
  /** Server/internal read, with the same tenant authorization as ingestion.
   * No public GET or list endpoint exists. */
  async readDecision(
    id: string,
    headers: Headers,
  ): Promise<DecisionRecord | null> {
    if (!this.options.enabled || !UUID.test(id)) return null;
    const tenant = this.tenant(headers);
    if (!tenant) return null;
    const raw = await this.options.backend.read(id.toLowerCase());
    if (!raw) return null;
    const record = JSON.parse(raw) as DecisionRecord;
    return record.tenantHash === tenant && record.expiresAt > this.now()
      ? record
      : null;
  }
  private async verify(
    record: DecisionRecord,
    submission: OutcomeSubmission,
  ): Promise<{ outcome: Outcome; proofKey?: string }> {
    const base = { at: new Date(this.now()).toISOString() };
    if (submission.kind === "feedback")
      return {
        outcome: {
          ...base,
          status: "unverified-caller-feedback",
          verification: "unverified",
          reason: "caller-reported-not-service-proof",
        },
      };
    if (submission.kind === "dispute")
      return {
        outcome: {
          ...base,
          status: "unverified-service-dispute",
          verification: "unverified",
          reason: "dispute-not-adjudicated",
        },
      };
    const binding = record.settlement;
    const proofReference = this.hash("proof-reference", [
      record.tenantHash,
      submission.txHash,
      submission.logIndex,
    ]);
    const unverified = (reason: string): { outcome: Outcome } => ({
      outcome: {
        ...base,
        proofReference,
        status: "unverified-transaction",
        verification: "unverified",
        reason,
      },
    });
    if (!binding) return unverified("missing-complete-binding");
    if (record.verdict !== "GO") return unverified("decision-not-go");
    if (!this.options.verifier)
      return unverified("proof-verifier-unconfigured");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const observation = await Promise.race([
        this.options.verifier(submission.txHash, submission.logIndex),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("timeout")), 6000);
        }),
      ]);
      if (
        observation.chainId !== binding.chainId ||
        observation.txHash.toLowerCase() !== submission.txHash
      )
        return unverified("wrong-network-or-transaction");
      if (observation.status === "pending" || !observation.finalized)
        return {
          outcome: {
            ...base,
            proofReference,
            status: "pending-transaction",
            verification: "pending",
            reason: "not-finalized",
          },
        };
      if (
        !Number.isSafeInteger(observation.blockTime) ||
        observation.blockTime! <
          Math.ceil(Date.parse(record.createdAt) / 1000) ||
        observation.blockTime! > Math.floor(this.now() / 1000) ||
        ![observation.asset, observation.payer, observation.payee].every(
          (value) => typeof value === "string" && ADDRESS.test(value),
        ) ||
        this.hash("address", [
          record.tenantHash,
          observation.asset!.toLowerCase(),
        ]) !== binding.assetHash ||
        this.hash("address", [
          record.tenantHash,
          observation.payer!.toLowerCase(),
        ]) !== binding.payerHash ||
        this.hash("address", [
          record.tenantHash,
          observation.payee!.toLowerCase(),
        ]) !== binding.payeeHash ||
        observation.amountBaseUnits !== binding.amountBaseUnits
      )
        return unverified("unrelated-or-mismatched-payment");
      if (
        observation.status === "success" &&
        observation.logIndex !== submission.logIndex
      )
        return unverified("missing-matching-transfer");
      if (!["success", "reverted"].includes(observation.status))
        return unverified("invalid-proof-status");
      return {
        outcome: {
          ...base,
          proofReference,
          status:
            observation.status === "success"
              ? "verified-matching-settlement"
              : "verified-reverted",
          verification: "verified",
          reason:
            observation.status === "success"
              ? "finalized-matching-erc20-transfer-not-service-proof"
              : "finalized-matching-transfer-attempt-reverted",
        },
        // Global, not tenant scoped: one whole transaction may count for at
        // most one decision, even if it has several logs. Conservative by design.
        proofKey: this.hash("global-transaction", [
          binding.chainId,
          submission.txHash,
        ]),
      };
    } catch {
      return unverified("proof-unavailable");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async ingest(value: unknown, headers: Headers): Promise<Result> {
    if (!this.options.enabled) return denied("disabled", 404);
    const tenant = this.tenant(headers);
    if (!tenant) return denied("unauthorized", 401);
    const submission = parseOutcomeSubmission(value);
    if (!submission) return denied("invalid-submission", 400);
    const fingerprint = this.hash("report", submission);
    try {
      if (!(await this.options.backend.admit(tenant)))
        return denied("attempt-limit", 429);
      const raw = await this.options.backend.read(submission.decisionId);
      if (!raw) return denied("not-found", 404);
      const record = JSON.parse(raw) as DecisionRecord;
      if (record.tenantHash !== tenant || record.expiresAt <= this.now())
        return denied("not-found", 404);
      const previous = record.reports[submission.reportId];
      if (previous)
        return previous === fingerprint
          ? {
              stored: true,
              decisionId: record.id,
              duplicate: true,
              outcome:
                submission.kind === "dispute" ? record.dispute : record.outcome,
            }
          : denied("report-id-replay", 409);
      if (Object.keys(record.reports).length >= 8)
        return denied("report-limit", 429);
      const verified = await this.verify(record, submission);
      if (
        submission.kind !== "dispute" &&
        record.outcome?.verification === "verified"
      ) {
        if (
          record.outcome.proofReference !== verified.outcome.proofReference ||
          record.outcome.status !== verified.outcome.status
        )
          return denied("verified-outcome-conflict", 409);
      }
      const updated: DecisionRecord = {
        ...record,
        reports: { ...record.reports, [submission.reportId]: fingerprint },
        ...(submission.kind === "dispute"
          ? { dispute: verified.outcome }
          : { outcome: verified.outcome }),
      };
      const result = await this.options.backend.atomic({
        record: updated,
        expected: raw,
        proofKey: verified.proofKey,
      });
      if (result === "conflict") {
        // Concurrent identical reports are idempotent without retrying writes.
        const fresh = await this.options.backend.read(record.id);
        const current = fresh ? (JSON.parse(fresh) as DecisionRecord) : null;
        if (current?.reports[submission.reportId] === fingerprint)
          return {
            stored: true,
            decisionId: record.id,
            duplicate: true,
            outcome:
              submission.kind === "dispute" ? current.dispute : current.outcome,
          };
      }
      if (result !== "stored")
        return denied(result, result === "limited" ? 429 : 409);
      return { stored: true, decisionId: record.id, outcome: verified.outcome };
    } catch {
      return denied("storage-unavailable", 503);
    }
  }
}
