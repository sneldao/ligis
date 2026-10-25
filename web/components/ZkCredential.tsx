"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Term } from "@/components/Term";
import { explainZk, shortHash } from "@/lib/decision-copy";
import type { ZkCredentialResult } from "@/lib/decide";

/**
 * Renders `Decision.zkCredential` in plain language first (what happened,
 * what to do), with the cryptographic details disclosed on intent.
 * Ink/terra tones only: the overall verdict owns sage/revoke.
 */
export function ZkCredentialResultView({ zk }: { zk: ZkCredentialResult }) {
  const copy = explainZk(zk);
  const tone =
    zk.status === "GO"
      ? { border: "border-ink", text: "text-ink" }
      : zk.status === "STOP"
        ? { border: "border-terra", text: "text-terra" }
        : { border: "border-rule", text: "text-ink-soft" };
  return (
    <div
      className={`border-l-2 pl-6 ${tone.border}`}
      data-testid="zk-credential"
    >
      <p className="eyebrow">private credential proof</p>
      <p className={`mt-2 font-serif text-xl ${tone.text}`}>{copy.title}</p>
      <p className="mt-2 font-serif text-base leading-relaxed text-ink-soft">
        {copy.plain}
      </p>
      <p className="mt-2 font-serif text-base leading-relaxed text-ink">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          Next ·{" "}
        </span>
        {copy.next}
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft hover:text-ink">
          Technical details
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px] text-ink-quiet">
          <dt>result</dt>
          <dd>
            {zk.verification} · {zk.status}
          </dd>
          <dt>gate said</dt>
          <dd className="break-words [overflow-wrap:anywhere]">{zk.reason}</dd>
          <dt>
            <Term term="registryRoot">registry root</Term>
          </dt>
          <dd className="tabular">
            {shortHash(zk.registryRoot)}
            {zk.rootSource
              ? ` (${zk.rootSource === "manifest" ? "published" : "pinned"})`
              : ""}
            {zk.registryRoot?.toLowerCase() ===
            "0x26d13aae1b3262afd3a557f601a2cee7376350ab71892de181691420e0829349" ? (
              <>
                {" · "}
                <a
                  href="https://testnet.monadscan.com/tx/0x91f64222c9e2f1c8d31668a3dd4688f6717f0a719668573998861f932e6ad49f"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                >
                  Monad anchor 0x91f6··d49f ↗
                </a>
              </>
            ) : null}
          </dd>
          <dt>
            <Term term="nullifier">nullifier</Term>
          </dt>
          <dd className="tabular">{shortHash(zk.nullifier)}</dd>
          {zk.verifier ? (
            <>
              <dt>verifier</dt>
              <dd>
                {zk.verifier} · {zk.latencyMs}ms
              </dd>
            </>
          ) : null}
        </dl>
      </details>
    </div>
  );
}

const MAX_PROOF_FILE = 256 * 1024;

/**
 * Attach a zk credential proof: upload the JSON file a prover wrote, or
 * paste it. For a one-click proof, the guided demo at /zcash generates one.
 * Submit is an explicit action (not an effect): a verified proof burns its
 * nullifier, so a re-render must never replay it.
 */
export function ZkProofAttach({
  onSubmit,
  busy,
}: {
  onSubmit: (zkProof: unknown) => void;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [provingDemo, setProvingDemo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadDemoProof = async () => {
    setProvingDemo(true);
    setErr(null);
    try {
      const res = await fetch("/api/zk/demo-proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: "holder" }),
      });
      const data = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) {
        setErr(
          data.error ??
            "Live demo prover is off on this server — open /zcash for the guided walkthrough or upload a .json proof file.",
        );
        return;
      }
      const raw = JSON.stringify(data.zkProof, null, 2);
      setText(raw);
      setFileName("demo-holder-proof.json");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProvingDemo(false);
    }
  };
  const submit = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !("proof" in parsed)) {
        setErr(
          "That JSON isn't a proof: expected { proof, contextLabel, publicInputs }.",
        );
        return;
      }
      setErr(null);
      onSubmit(parsed);
    } catch {
      setErr("That isn't valid JSON. Upload the .json file your prover wrote.");
    }
  };
  return (
    <details className="group border-t border-rule pt-4">
      <summary className="cursor-pointer list-none py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
        Payee has a private credential proof? Attach it →
      </summary>
      <div className="mt-3 space-y-4">
        <p className="font-serif text-sm leading-relaxed text-ink-soft">
          A shielded payee can prove it holds a valid credential without
          revealing who it is (a{" "}
          <Term term="zkProof">zero-knowledge proof</Term>). Each proof works
          once per payment. No proof handy?{" "}
          <Link
            href="/zcash"
            className="text-ink underline decoration-terra decoration-1 underline-offset-4"
          >
            Generate one in the guided Zcash demo
          </Link>
          .
        </p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            id="zk-proof-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > MAX_PROOF_FILE) {
                setErr("That file is too large to be a proof (max 256 KB).");
                return;
              }
              setFileName(f.name);
              const t = await f.text();
              setText(t);
              setErr(null);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="border border-terra px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper"
          >
            Upload proof file
          </button>
          <button
            type="button"
            disabled={provingDemo || busy}
            onClick={loadDemoProof}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra disabled:text-ink-quiet"
          >
            {provingDemo ? "Generating demo proof…" : "Generate demo proof"}
          </button>
          {fileName ? (
            <span className="font-mono text-[11px] text-ink-quiet">
              {fileName} · {Math.round(text.length / 1024)} KB loaded
            </span>
          ) : null}
        </div>
        <details>
          <summary className="cursor-pointer py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet hover:text-ink">
            or paste JSON
          </summary>
          <label htmlFor="zk-proof-json" className="sr-only">
            Proof JSON
          </label>
          <textarea
            id="zk-proof-json"
            className="mt-2 h-28 w-full bg-paper-deep p-3 font-mono text-[11px] text-ink"
            placeholder='{"proof":"0x…","contextLabel":"ligis-gate:v1:…","publicInputs":{…}}'
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
            }}
          />
        </details>
        {err ? (
          <p role="alert" className="font-serif text-sm text-terra">
            {err}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || !text.trim()}
          className="border border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-ink hover:text-paper disabled:border-rule disabled:text-ink-quiet disabled:hover:bg-transparent"
          onClick={() => submit(text)}
        >
          {busy ? "Verifying proof…" : "Run the gate with this proof"}
        </button>
      </div>
    </details>
  );
}
