"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  createPasskey,
  signChallenge,
  webauthnAvailable,
  type EnrolledPasskey,
} from "@/lib/webauthn";
import type { Decision } from "@/lib/decide";

const PrivyOnboarding = dynamic(() => import("./PrivyOnboarding"), {
  ssr: false,
});
type Config = {
  fixture: boolean;
  origin: string;
  rpId: string;
  readState: string;
  reason: string;
  sponsorMode: string;
  onboardingAppId: string | null;
};
type Credential = {
  subject: string;
  capable: boolean;
  revoked: boolean;
  issuer: string;
  expiresAt: string;
};
const buttonClass =
  "border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:opacity-50";

export function PasskeyCeremony() {
  const [config, setConfig] = useState<Config | null>(null);
  const [origin, setOrigin] = useState("");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [key, setKey] = useState<EnrolledPasskey | null>(null);
  const [admitted, setAdmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading onboarding configuration.");
  const [credential, setCredential] = useState<Credential | null>(null);
  const [receipt, setReceipt] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [gateError, setGateError] = useState("");
  const [scenario, setScenario] = useState("confirmed");

  async function post(action: string, body: Record<string, unknown> = {}) {
    const response = await fetch("/api/passkey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Fixture ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const out = await response.json();
    if (!response.ok) throw new Error(out.error ?? "Onboarding unavailable.");
    return out;
  }
  useEffect(() => {
    setOrigin(window.location.origin);
    setSupported(webauthnAvailable());
    post("config")
      .then((out: Config) => {
        setConfig(out);
        setMessage(
          out.fixture
            ? "Local mocked workflow. No chain writes, funded wallet, KYC, accreditation or commerce trust."
            : out.reason,
        );
      })
      .catch(() =>
        setMessage(
          "Configuration unavailable. Read-only; no transaction occurred.",
        ),
      );
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Ceremony canceled or timed out. No confirmed transaction."
          : error instanceof Error
            ? error.message
            : "Onboarding unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(operation: "issue" | "revoke") {
    if (!config || !key) return;
    setDecision(null);
    setGateError("");
    setCredential(null);
    setReceipt("Awaiting authenticator");
    const prep = await post("fixturePrepare", { operation });
    const assertion = await signChallenge(
      config.rpId,
      prep.digest,
      key.credentialId,
    );
    setReceipt("Submitting fixture sponsored assertion");
    const out = await post("fixtureSubmit", {
      operationId: prep.id,
      ...assertion,
      scenario,
    });
    setReceipt(
      `Fixture receipt: ${out.receipt}. No explorer transaction exists.`,
    );
    if (out.receipt !== "confirmed") {
      setMessage(
        `Fixture transaction ${out.receipt}. No successful credential read.`,
      );
      return;
    }
    if (!out.credential) {
      setMessage(
        "Fixture receipt confirmed, but credential read unavailable. No success inferred.",
      );
      return;
    }
    setCredential(out.credential);
    setMessage(
      operation === "issue"
        ? "Fixture demo.passkey issued after simulated operator admission."
        : "Fixture demo.passkey revoked by the admitted operator passkey.",
    );
  }
  async function askGate() {
    setDecision(null);
    setGateError("");
    try {
      const response = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payee: wallet,
          amountUsd: 1,
          capability: "demo.passkey",
          purpose:
            "Low-criticality passkey demo permission read. No payment is sent.",
          mandate: {
            payees: [wallet],
            maxUsd: 1,
            expectedUsd: 1,
            scope: "demo.passkey only; no commerce trust",
          },
        }),
      });
      const out = await response.json();
      if (
        !response.ok ||
        !["GO", "STOP", "UNKNOWN"].includes(out.verdict) ||
        !Array.isArray(out.signals)
      )
        throw new Error("Full risk gate unavailable.");
      setDecision(out);
    } catch {
      setGateError(
        "UNKNOWN · Full risk gate read failed. No payment permission inferred.",
      );
    }
  }
  const originOk =
    !!config &&
    config.origin === origin &&
    config.rpId === new URL(origin).hostname;
  const enabled = !!config?.fixture && originOk && supported === true && !busy;

  return (
    <div className="space-y-8">
      <p
        role="status"
        aria-live="polite"
        className="max-w-prose font-serif text-base leading-relaxed text-ink-soft"
      >
        {message}
      </p>
      {supported === false && (
        <p className="font-serif text-sm text-revoke">
          Unsupported browser or insecure context. HTTPS (or local
          secure-context testing) and a verifying authenticator are required.
        </p>
      )}
      {config && !originOk && (
        <p className="font-serif text-sm text-revoke">
          Wrong serving origin. Expected {config.origin}. Live RP-ID rotation is
          not a testing workaround.
        </p>
      )}
      {config && !config.fixture && (
        <p className="font-serif text-sm text-ink-soft">
          Read-only · sponsorship {config.sponsorMode} · contract context{" "}
          {config.readState}. Public enrollment is forbidden.
        </p>
      )}
      {config?.onboardingAppId && (
        <PrivyOnboarding appId={config.onboardingAppId} />
      )}
      {config?.fixture && (
        <>
          <p className="eyebrow">
            Local fixture · real browser P-256 assertion · mocked wallet,
            admission and receipts
          </p>
          <ol className="divide-y divide-rule border-y border-rule">
            <li className="space-y-4 py-6">
              <h2 className="font-serif text-lg text-ink">
                01 · Sign in without a seed phrase
              </h2>
              <p className="font-serif text-sm text-ink-soft">
                Simulate a provider account and controlled embedded agent
                wallet. This fixture is not a Privy login or a funded wallet.
              </p>
              <button
                className={buttonClass}
                disabled={!enabled || !!token}
                onClick={() =>
                  run(async () => {
                    const out = await post("fixtureLogin");
                    setToken(out.token);
                    setWallet(out.wallet);
                    setMessage(
                      "Fixture account signed in. Not admitted to the shared issuer.",
                    );
                  })
                }
              >
                Simulate seedless sign-in
              </button>
              {wallet && (
                <p className="break-all font-mono text-xs text-ink-soft">
                  Embedded agent wallet (mock): {wallet}
                </p>
              )}
            </li>
            <li className="space-y-4 py-6">
              <h2 className="font-serif text-lg text-ink">
                02 · Prepare a separate issuer passkey
              </h2>
              <p className="font-serif text-sm text-ink-soft">
                The login credential authenticates a user. A secp256k1 wallet
                key signs a wallet transaction. This P-256 key authorizes the
                issuer desk only after owner admission. Creating it grants no
                authority.
              </p>
              <button
                className={buttonClass}
                disabled={!enabled || !token || !!key}
                onClick={() =>
                  run(async () => {
                    setMessage("Waiting for user verification.");
                    setKey(
                      await createPasskey(
                        config.rpId,
                        "ligis-fixture-operator",
                      ),
                    );
                    setMessage(
                      "Local public key prepared. Operator admission still required.",
                    );
                  })
                }
              >
                Create local issuer passkey
              </button>
              <button
                className={buttonClass}
                disabled={!enabled || !key || admitted}
                onClick={() =>
                  run(async () => {
                    await post("fixtureAdmit", {
                      keyId: key!.keyId,
                      qx: key!.qx,
                      qy: key!.qy,
                    });
                    setAdmitted(true);
                    setMessage(
                      "Simulated owner admitted this fixture operator. No live enrollment occurred.",
                    );
                  })
                }
              >
                Simulate authorized operator admission
              </button>
            </li>
            <li className="space-y-4 py-6">
              <h2 className="font-serif text-lg text-ink">
                03 · Issue, read, ask the full gate, then revoke
              </h2>
              <label className="block font-mono text-xs text-ink-soft">
                Fixture receipt scenario
                <select
                  className="ml-3 border border-rule bg-paper p-2 text-ink"
                  disabled={busy}
                  value={scenario}
                  onChange={(event) => setScenario(event.target.value)}
                >
                  <option value="confirmed">Confirmed and readable</option>
                  <option value="pending">Pending</option>
                  <option value="reverted">Reverted</option>
                  <option value="read-failure">Read failure</option>
                  <option value="outage">Sponsor outage</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  className={buttonClass}
                  disabled={!enabled || !admitted}
                  onClick={() => run(() => submit("issue"))}
                >
                  Touch to issue fixture
                </button>
                <button
                  className={buttonClass}
                  disabled={!enabled || !credential || credential.revoked}
                  onClick={() => run(() => submit("revoke"))}
                >
                  Touch to revoke fixture
                </button>
                <button
                  className={buttonClass}
                  disabled={busy || !wallet}
                  onClick={() => run(askGate)}
                >
                  Ask full risk gate
                </button>
              </div>
              {receipt && (
                <p role="status" className="font-serif text-sm text-ink-soft">
                  {receipt}
                </p>
              )}
              {credential && (
                <div className="space-y-2 font-mono text-xs text-ink-soft">
                  <p>
                    Fixture credential read: demo.passkey ·{" "}
                    {credential.revoked ? "revoked" : "active"} · capability{" "}
                    {String(credential.capable)}
                  </p>
                  <p className="break-all">Issuer: {credential.issuer}</p>
                  <p>Capability state is one signal, not a GO verdict.</p>
                </div>
              )}
            </li>
          </ol>
          <p className="font-serif text-sm text-ink-soft">
            The full gate below reads its real configured sources, not the
            fixture credential. A fixture capability cannot create live trust.
            No GO is derived from isCapable.
          </p>
        </>
      )}
      {gateError && (
        <p role="status" className="font-serif text-sm text-revoke">
          {gateError}
        </p>
      )}
      {decision && (
        <section
          aria-label="Full risk gate decision"
          className="space-y-4 border-t border-rule py-6"
        >
          <p className="eyebrow">
            Full risk gate response · no payment submitted
          </p>
          <p className="display text-5xl text-ink">{decision.verdict}</p>
          <ul className="space-y-2 font-mono text-xs text-ink-soft">
            {decision.signals.map((signal) => (
              <li key={signal.id}>
                {signal.id}: {signal.status} {signal.reason ?? ""}
              </li>
            ))}
          </ul>
          <p className="font-serif text-sm text-ink-soft">
            {decision.provenance?.join(" · ")}
          </p>
        </section>
      )}
    </div>
  );
}
