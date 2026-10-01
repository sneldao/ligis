"use client";

import { useCallback, useEffect, useState } from "react";
import { GateVerdict, type GateVerdictInput } from "@/components/GateVerdict";
import {
  createPasskey,
  loadPasskey,
  signChallenge,
  storePasskey,
  webauthnAvailable,
  type StoredPasskey,
} from "@/lib/webauthn";
import { truncateAddress } from "@/lib/format";

type Config = {
  rpId: string;
  rpIdMatchesChain: boolean;
  registry: string;
  passkeyIssuer: string;
  stewardAddress: string | null;
  explorerUrl: string;
  writeReady: boolean;
};

type StepState = {
  status: "idle" | "working" | "done" | "error";
  detail?: string;
  tx?: string;
};

type IssueCtx = {
  subject: string;
  capability: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  capabilityHash: string;
};

const IDLE: StepState = { status: "idle" };

async function post(action: string, body: Record<string, unknown>) {
  const res = await fetch("/api/passkey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
}

const ctaClass =
  "inline-flex items-center gap-2 justify-center border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:opacity-50 disabled:hover:bg-paper disabled:hover:text-ink";

export function PasskeyCeremony() {
  const [config, setConfig] = useState<Config | null>(null);
  const [pk, setPk] = useState<StoredPasskey | null>(null);
  const [enroll, setEnroll] = useState<StepState>(IDLE);
  const [issue, setIssue] = useState<StepState>(IDLE);
  const [revoke, setRevoke] = useState<StepState>(IDLE);
  const [issueCtx, setIssueCtx] = useState<IssueCtx | null>(null);
  const [subject, setSubject] = useState("");
  const [capability, setCapability] = useState("demo.passkey");
  const [verdict, setVerdict] = useState<GateVerdictInput | null>(null);
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    setHost(window.location.hostname);
    post("config", {})
      .then((c: Config) => {
        setConfig(c);
        setSubject((s) => s || c.stewardAddress || "");
        setPk(loadPasskey(c.rpId));
      })
      .catch(() => setConfig(null));
  }, []);

  const originOk = !!config && host === config.rpId;
  const supported = webauthnAvailable();

  const onEnroll = useCallback(async () => {
    if (!config) return;
    setEnroll({ status: "working", detail: "waiting for the authenticator…" });
    try {
      const created = await createPasskey(config.rpId, "ligis-agent");
      setEnroll({
        status: "working",
        detail: "enrolling public key on-chain…",
      });
      const res = await post("enroll", {
        keyId: created.keyId,
        qx: created.qx,
        qy: created.qy,
      });
      const stored: StoredPasskey = { ...created, rpId: config.rpId };
      storePasskey(stored);
      setPk(stored);
      setEnroll({
        status: "done",
        detail: res.alreadyEnrolled
          ? "already enrolled — public key on file"
          : "public key enrolled on Monad",
        tx: res.tx ?? undefined,
      });
    } catch (err) {
      setEnroll({
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, [config]);

  const onIssue = useCallback(async () => {
    if (!config || !pk) return;
    setIssue({
      status: "working",
      detail: "asking the registry for the digest…",
    });
    setVerdict(null);
    setRevoke(IDLE);
    try {
      const prep = await post("prepareIssue", { subject, capability });
      setIssue({
        status: "working",
        detail: "touch to sign the credential digest…",
      });
      const assertion = await signChallenge(
        config.rpId,
        prep.digest,
        pk.credentialId,
      );
      setIssue({
        status: "working",
        detail: "submitting — 0x0100 verifies on-chain…",
      });
      const out = await post("issue", {
        subject,
        capability,
        issuedAt: prep.issuedAt,
        expiresAt: prep.expiresAt,
        nonce: prep.nonce,
        keyId: pk.keyId,
        authenticatorData: assertion.authenticatorData,
        clientDataJSON: assertion.clientDataJSON,
        r: assertion.r,
        s: assertion.s,
      });
      setIssueCtx({
        subject,
        capability,
        nonce: prep.nonce,
        issuedAt: prep.issuedAt,
        expiresAt: prep.expiresAt,
        capabilityHash: prep.capabilityHash,
      });
      setIssue({
        status: "done",
        detail: "credential minted — passkey authorized",
        tx: out.tx,
      });
      setVerdict({
        capable: Boolean(out.capable),
        subject,
        capabilityId: capability,
        issuer: config.passkeyIssuer,
        expiresAt: BigInt(prep.expiresAt),
        revoked: false,
      });
    } catch (err) {
      setIssue({
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, [config, pk, subject, capability]);

  const onRevoke = useCallback(async () => {
    if (!config || !pk || !issueCtx) return;
    setRevoke({
      status: "working",
      detail: "touch to sign the revoke digest…",
    });
    try {
      const prep = await post("prepareRevoke", {
        subject: issueCtx.subject,
        capabilityHash: issueCtx.capabilityHash,
        nonce: issueCtx.nonce,
      });
      const assertion = await signChallenge(
        config.rpId,
        prep.digest,
        pk.credentialId,
      );
      setRevoke({ status: "working", detail: "submitting revoke…" });
      const out = await post("revoke", {
        subject: issueCtx.subject,
        capability: issueCtx.capability,
        nonce: issueCtx.nonce,
        keyId: pk.keyId,
        authenticatorData: assertion.authenticatorData,
        clientDataJSON: assertion.clientDataJSON,
        r: assertion.r,
        s: assertion.s,
      });
      setRevoke({
        status: "done",
        detail: "credential revoked by passkey",
        tx: out.tx,
      });
      setVerdict({
        capable: Boolean(out.capable),
        subject: issueCtx.subject,
        capabilityId: issueCtx.capability,
        issuer: config.passkeyIssuer,
        expiresAt: BigInt(issueCtx.expiresAt),
        revoked: !out.capable,
      });
    } catch (err) {
      setRevoke({
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, [config, pk, issueCtx]);

  function Step({
    n,
    title,
    state,
    children,
  }: {
    n: string;
    title: string;
    state: StepState;
    children: React.ReactNode;
  }) {
    return (
      <li className="py-6 first:pt-0">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
            {n}
          </span>
          <p className="font-serif text-lg text-ink">{title}</p>
        </div>
        <div className="mt-3 sm:pl-12">{children}</div>
        {state.detail && (
          <p
            className={`mt-3 sm:pl-12 font-serif text-sm leading-relaxed ${
              state.status === "error"
                ? "text-revoke"
                : state.status === "done"
                  ? "text-sage"
                  : "text-ink-quiet"
            }`}
          >
            {state.detail}
            {state.tx && config && (
              <>
                {" "}
                <a
                  href={`${config.explorerUrl}/tx/${state.tx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs tabular underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
                >
                  {truncateAddress(state.tx, 8, 6)}
                </a>
              </>
            )}
          </p>
        )}
      </li>
    );
  }

  if (!supported) {
    return (
      <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">
        This browser does not expose passkeys. The ceremony needs HTTPS and a
        platform authenticator (Touch ID, Windows Hello, or a security key).
      </p>
    );
  }

  return (
    <div>
      {config && !originOk && (
        <p className="mb-8 max-w-prose font-serif text-base leading-relaxed text-revoke">
          Assertions are bound to{" "}
          <span className="font-mono">{config.rpId}</span>. You are on{" "}
          <span className="font-mono">{host}</span> — run this ceremony on{" "}
          <a
            href={`https://${config.rpId}/passkey`}
            className="underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            {config.rpId}
          </a>{" "}
          for the on-chain verification to pass.
        </p>
      )}

      {config && !config.writeReady && (
        <p className="mb-8 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          No relay key configured on this deployment — the passkey ceremony is
          read-only here.
        </p>
      )}

      <ol className="divide-y divide-rule border-y border-rule">
        <Step n="01" title="Enroll" state={enroll}>
          <p className="mb-4 max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            Create a passkey on this device. Its P-256 public key is written to
            the PasskeyIssuer contract — the issuer is hardware, not an env
            file.
          </p>
          <button
            type="button"
            onClick={onEnroll}
            disabled={
              !config ||
              !originOk ||
              !config.writeReady ||
              enroll.status === "working"
            }
            className={ctaClass}
          >
            {pk ? "re-enroll passkey" : "enroll this passkey"}
          </button>
          {pk && (
            <p className="mt-3 font-mono text-xs tabular text-ink-quiet sm:pl-0">
              keyId {truncateAddress(pk.keyId, 8, 6)}
            </p>
          )}
        </Step>

        <Step n="02" title="Issue a credential" state={issue}>
          <div className="mb-4 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                subject (agent)
              </span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                spellCheck={false}
                className="mt-1 w-full border-b border-rule bg-transparent py-1.5 font-mono text-sm tabular text-ink outline-none focus:border-terra"
                placeholder="0x…"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                capability
              </span>
              <input
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
                spellCheck={false}
                className="mt-1 w-full border-b border-rule bg-transparent py-1.5 font-mono text-sm tabular text-ink outline-none focus:border-terra"
                placeholder="demo.passkey"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={onIssue}
            disabled={
              !pk ||
              !originOk ||
              !config?.writeReady ||
              issue.status === "working" ||
              !subject
            }
            className={ctaClass}
          >
            touch to issue
          </button>
        </Step>

        <Step n="03" title="Revoke it" state={revoke}>
          <p className="mb-4 max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
            The same touch ends the credential. The gate flips GO → STOP inside
            one Monad block.
          </p>
          <button
            type="button"
            onClick={onRevoke}
            disabled={!issueCtx || !originOk || revoke.status === "working"}
            className={ctaClass}
          >
            touch to revoke
          </button>
        </Step>
      </ol>

      {verdict && config && (
        <div className="mt-10">
          <GateVerdict
            verdict={verdict}
            explorerUrl={config.explorerUrl}
            source="monad testnet state"
          />
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
            <a
              href={`/gate?chain=monad-testnet&subject=${verdict.subject}&capability=${verdict.capabilityId}`}
              className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              gate it → shareable check
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
