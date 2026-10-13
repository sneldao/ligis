"use client";

import { useState } from "react";
import {
  PrivyProvider,
  usePrivy,
  useWallets,
  useLoginWithPasskey,
  useSignupWithPasskey,
} from "@privy-io/react-auth";
import { monadTestnet } from "viem/chains";

const buttonClass =
  "border border-terra px-5 py-2 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50";

function SignIn() {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signupWithPasskey } = useSignupWithPasskey();
  const { loginWithPasskey } = useLoginWithPasskey();
  const [message, setMessage] = useState(
    "Sign-in does not admit an issuer key or mint trust.",
  );
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setMessage(
        "Authenticated. Issuer enrollment and sponsored writes remain unavailable.",
      );
    } catch {
      setMessage(
        "Sign-in canceled or provider unavailable. No enrollment or transaction occurred.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    const token = await getAccessToken();
    const response = await fetch("/api/passkey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
      },
      body: JSON.stringify({ action: "identity" }),
    });
    if (!response.ok) throw new Error("Authentication unavailable");
  }
  const wallet = wallets.find((item) => item.walletClientType === "privy");
  return (
    <div className="space-y-4 border-y border-rule py-6">
      <p className="eyebrow">Optional Privy onboarding · writes disabled</p>
      <p className="font-serif text-sm text-ink-soft">
        A Privy login passkey authenticates your account. The embedded
        wallet&apos;s secp256k1 key would sign its transactions. A separately
        admitted P-256 issuer passkey authorizes claims. These are three
        distinct roles.
      </p>
      {!authenticated ? (
        <div className="flex flex-wrap gap-3">
          <button
            className={buttonClass}
            disabled={!ready || busy}
            onClick={() => run(signupWithPasskey)}
          >
            Sign up with Privy passkey
          </button>
          <button
            className={buttonClass}
            disabled={!ready || busy}
            onClick={() => run(loginWithPasskey)}
          >
            Sign in with Privy passkey
          </button>
        </div>
      ) : (
        <>
          <p className="break-all font-mono text-xs text-ink">
            Embedded agent wallet:{" "}
            {wallet?.address ?? "creation pending or unavailable"}
          </p>
          <div className="flex gap-3">
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => run(verify)}
            >
              Verify account session
            </button>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => run(logout)}
            >
              Sign out
            </button>
          </div>
        </>
      )}
      <p role="status" className="font-serif text-sm text-ink-soft">
        {message}
      </p>
    </div>
  );
}

export default function PrivyOnboarding({ appId }: { appId: string }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["passkey"],
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <SignIn />
    </PrivyProvider>
  );
}
