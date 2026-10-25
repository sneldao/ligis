import { randomUUID } from "node:crypto";
import { destinationFingerprint } from "./fingerprint.js";
import type { AttemptState, Money } from "./types.js";

export interface TransferHandle {
  transferId: string;
  status: string;
  failureType?: string;
  failureReason?: string;
}

export interface CreateTransferInput {
  requestId: string;
  beneficiaryId: string;
  amount: Money;
  reference: string;
  reason: string;
}

export interface PayoutRail {
  createTransfer(input: CreateTransferInput): Promise<TransferHandle>;
  getTransfer(transferId: string): Promise<TransferHandle>;
  findByRequestId(requestId: string): Promise<TransferHandle | null>;
  getBalance(currency: string): Promise<number>;
  /** Fingerprint of the destination the beneficiary record currently holds. */
  getBeneficiaryFingerprint(beneficiaryId: string): Promise<string>;
}

export interface TransferSimulator {
  transition(
    transferId: string,
    to: "SENT" | "PAID" | "FAILED",
    failureType?: string,
  ): Promise<void>;
}

/** Map an Airwallex transfer status onto our attempt state machine. */
export function mapTransferStatus(status: string): AttemptState {
  if (status === "PAID") return "PAID";
  if (status === "CANCELLED" || status === "FAILED") return "CANCELLED";
  return "IN_FLIGHT";
}

const TERMINAL = new Set(["PAID", "CANCELLED", "FAILED"]);

interface FixtureTransfer {
  id: string;
  requestId: string;
  beneficiaryId: string;
  amount: Money;
  reference: string;
  reason: string;
  status: string;
  failureType?: string;
  failureReason?: string;
}

export class RailError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RailError";
  }

  /** True when the rail validated and refused the request (definite 4xx). */
  isDefiniteRejection(): boolean {
    return (
      this.status !== undefined &&
      [400, 401, 403, 404, 422].includes(this.status)
    );
  }
}

export class RailTimeoutError extends Error {
  constructor(message = "transfer create timed out") {
    super(message);
    this.name = "RailTimeoutError";
  }
}

/** In-memory rail with Airwallex semantics for tests and demos. */
export class FixtureRail implements PayoutRail, TransferSimulator {
  createCalls = 0;
  private transfers = new Map<string, FixtureTransfer>();
  private byRequestId = new Map<string, string>();
  private balances = new Map<string, number>();
  private beneficiaries = new Map<string, string>();
  private failNextTimeout = false;

  constructor(initialBalances: Record<string, number> = {}) {
    for (const [cur, amt] of Object.entries(initialBalances)) {
      this.balances.set(cur, amt);
    }
  }

  /** Record the next create server-side but throw a timeout to the caller. */
  failNextCreateWithTimeout(): void {
    this.failNextTimeout = true;
  }

  async createTransfer(input: CreateTransferInput): Promise<TransferHandle> {
    this.createCalls += 1;
    const existing = this.byRequestId.get(input.requestId);
    if (existing) {
      const prior = this.transfers.get(existing)!;
      const same =
        prior.beneficiaryId === input.beneficiaryId &&
        prior.amount.amount === input.amount.amount &&
        prior.amount.currency === input.amount.currency;
      if (!same) {
        throw new RailError(
          "request_id reused for a different operation",
          "duplicate_request_id",
          400,
        );
      }
      return this.handle(prior);
    }
    const transfer: FixtureTransfer = {
      id: randomUUID(),
      requestId: input.requestId,
      beneficiaryId: input.beneficiaryId,
      amount: input.amount,
      reference: input.reference,
      reason: input.reason,
      status: "RECEIVED",
    };
    this.transfers.set(transfer.id, transfer);
    this.byRequestId.set(input.requestId, transfer.id);
    const balance = this.balances.get(input.amount.currency) ?? 0;
    this.balances.set(input.amount.currency, balance - input.amount.amount);
    if (this.failNextTimeout) {
      this.failNextTimeout = false;
      throw new RailTimeoutError();
    }
    return this.handle(transfer);
  }

  async getTransfer(transferId: string): Promise<TransferHandle> {
    const t = this.transfers.get(transferId);
    if (!t) throw new RailError("transfer not found", "not_found");
    return this.handle(t);
  }

  async findByRequestId(requestId: string): Promise<TransferHandle | null> {
    const id = this.byRequestId.get(requestId);
    return id ? this.handle(this.transfers.get(id)!) : null;
  }

  async getBalance(currency: string): Promise<number> {
    return this.balances.get(currency) ?? 0;
  }

  registerBeneficiary(beneficiaryId: string, fingerprint: string): void {
    this.beneficiaries.set(beneficiaryId, fingerprint);
  }

  /** Point the beneficiary record at a different destination (attack sim). */
  tamperBeneficiary(beneficiaryId: string, newFingerprint: string): void {
    this.beneficiaries.set(beneficiaryId, newFingerprint);
  }

  async getBeneficiaryFingerprint(beneficiaryId: string): Promise<string> {
    const fp = this.beneficiaries.get(beneficiaryId);
    if (!fp) throw new RailError("beneficiary not found", "not_found", 404);
    return fp;
  }

  async transition(
    transferId: string,
    to: "SENT" | "PAID" | "FAILED",
    failureType?: string,
  ): Promise<void> {
    const t = this.transfers.get(transferId);
    if (!t) throw new RailError("transfer not found", "not_found");
    if (TERMINAL.has(t.status)) return;
    t.status = to;
    if (to === "FAILED") {
      // Airwallex terminal failure status is CANCELLED with a failure_type.
      t.status = "CANCELLED";
      t.failureType = failureType ?? "OTHER";
      t.failureReason = "simulated failure";
      const balance = this.balances.get(t.amount.currency) ?? 0;
      this.balances.set(t.amount.currency, balance + t.amount.amount);
    }
  }

  private handle(t: FixtureTransfer): TransferHandle {
    return {
      transferId: t.id,
      status: t.status,
      failureType: t.failureType,
      failureReason: t.failureReason,
    };
  }
}

type FetchLike = typeof fetch;

export interface AirwallexSandboxRailOptions {
  clientId: string;
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** ms before considering the cached token stale. Default 25min. */
  tokenTtlMs?: number;
}

/** Airwallex sandbox rail: bearer-token auth, transfers + simulation. */
export class AirwallexSandboxRail implements PayoutRail, TransferSimulator {
  private baseUrl: string;
  private f: FetchLike;
  private token?: { value: string; expiresAt: number };
  private tokenTtlMs: number;

  constructor(private opts: AirwallexSandboxRailOptions) {
    this.baseUrl = opts.baseUrl ?? "https://api.sandbox.airwallex.com/api/v1";
    this.f = opts.fetch ?? fetch;
    this.tokenTtlMs = opts.tokenTtlMs ?? 25 * 60 * 1000;
  }

  private async login(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt)
      return this.token.value;
    const res = await this.f(`${this.baseUrl}/authentication/login`, {
      method: "POST",
      headers: {
        "x-client-id": this.opts.clientId,
        "x-api-key": this.opts.apiKey,
      },
    });
    if (!res.ok) {
      throw new RailError(
        `login failed: ${res.status}`,
        "auth_failed",
        res.status,
      );
    }
    const body = (await res.json()) as { token: string };
    this.token = { value: body.token, expiresAt: Date.now() + this.tokenTtlMs };
    return body.token;
  }

  private async api(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.login();
    const res = await this.f(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const code =
        (body as { code?: string } | null)?.code ?? `http_${res.status}`;
      throw new RailError(
        `airwallex ${path} failed: ${res.status} ${code}`,
        code,
        res.status,
      );
    }
    return body;
  }

  async createTransfer(input: CreateTransferInput): Promise<TransferHandle> {
    const body = (await this.api("/transfers/create", {
      method: "POST",
      body: JSON.stringify({
        request_id: input.requestId,
        beneficiary_id: input.beneficiaryId,
        transfer_currency: input.amount.currency,
        transfer_amount: String(input.amount.amount),
        transfer_method: "LOCAL",
        source_currency: input.amount.currency,
        reason: input.reason,
        reference: input.reference,
      }),
    })) as { id: string; status: string };
    return { transferId: body.id, status: body.status };
  }

  async getTransfer(transferId: string): Promise<TransferHandle> {
    const t = (await this.api(`/transfers/${transferId}`)) as {
      id: string;
      status: string;
      failure_type?: string;
      failure_reason?: string;
    };
    return {
      transferId: t.id,
      status: t.status,
      failureType: t.failure_type,
      failureReason: t.failure_reason,
    };
  }

  async findByRequestId(requestId: string): Promise<TransferHandle | null> {
    const res = (await this.api(
      `/transfers?request_id=${encodeURIComponent(requestId)}`,
    )) as {
      items?: {
        id: string;
        status: string;
        failure_type?: string;
        failure_reason?: string;
      }[];
    };
    const t = res.items?.[0];
    return t
      ? {
          transferId: t.id,
          status: t.status,
          failureType: t.failure_type,
          failureReason: t.failure_reason,
        }
      : null;
  }

  async getBalance(currency: string): Promise<number> {
    const res = (await this.api("/balances")) as {
      items?: {
        currency: string;
        available_amount?: number;
        total_amount?: number;
      }[];
    };
    const item = res.items?.find((i) => i.currency === currency);
    return item?.available_amount ?? item?.total_amount ?? 0;
  }

  async getBeneficiaryFingerprint(beneficiaryId: string): Promise<string> {
    const res = (await this.api(`/beneficiaries/${beneficiaryId}`)) as {
      beneficiary?: {
        bank_details?: {
          bank_country_code?: string;
          account_currency?: string;
          account_number?: string;
          account_routing_value1?: string;
          iban?: string;
          swift_code?: string;
        };
      };
    };
    const bd = res.beneficiary?.bank_details;
    if (!bd) {
      throw new RailError(
        `beneficiary ${beneficiaryId} has no bank_details`,
        "beneficiary_invalid",
      );
    }
    return destinationFingerprint({
      country: bd.bank_country_code ?? "",
      currency: bd.account_currency ?? "",
      accountNumber: bd.account_number,
      routingNumber: bd.account_routing_value1,
      iban: bd.iban,
      swift: bd.swift_code,
    });
  }

  async transition(
    transferId: string,
    to: "SENT" | "PAID" | "FAILED",
    failureType?: string,
  ): Promise<void> {
    await this.api(`/simulation/transfers/${transferId}/transition`, {
      method: "POST",
      body: JSON.stringify({
        next_status: to,
        ...(failureType ? { failure_type: failureType } : {}),
      }),
    });
  }

  /** Beneficiary helpers for live demo setup (schema-driven creation). */
  async beneficiarySchema(params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.api(`/beneficiaries/schema?${qs}`);
  }

  async createBeneficiary(body: unknown): Promise<string> {
    const res = (await this.api("/beneficiaries/create", {
      method: "POST",
      body: JSON.stringify(body),
    })) as { id: string };
    return res.id;
  }
}
