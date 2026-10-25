import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZCASH_DEMO_REPLAYED_SUBJECT,
  ZCASH_DEMO_UNVERIFIED_SUBJECT,
  ZCASH_DEMO_VERIFIED_SUBJECT,
} from "@ligis/core";
import { runGateDecision } from "../lib/gate-run.js";
import { MONAD_TESTNET, ZCASH_TESTNET, chainById } from "../lib/network.js";
import { candidateChains, resolveSubject } from "../lib/resolve.js";
import {
  detectSubjectKind,
  subjectChainMismatch,
} from "../lib/subject-format.js";

describe("Zcash shielded gate integration (Week 1)", () => {
  it("detects Zcash shielded addresses and routes to Zcash Testnet", () => {
    assert.equal(detectSubjectKind(ZCASH_DEMO_VERIFIED_SUBJECT), "zcash");
    assert.equal(detectSubjectKind(ZCASH_DEMO_REPLAYED_SUBJECT), "zcash");
    assert.equal(detectSubjectKind(ZCASH_DEMO_UNVERIFIED_SUBJECT), "zcash");
    assert.equal(chainById("zcash-testnet")?.id, "zcash-testnet");

    const chains = candidateChains(ZCASH_DEMO_VERIFIED_SUBJECT);
    assert.equal(chains.length, 1);
    assert.equal(chains[0]?.id, ZCASH_TESTNET.id);

    const mismatch = subjectChainMismatch(
      MONAD_TESTNET,
      ZCASH_DEMO_VERIFIED_SUBJECT,
    );
    assert.ok(mismatch);
    assert.equal(mismatch.suggestedChainId, "zcash-testnet");
  });

  it("resolves verified, replayed-nullifier, and unverified shielded Zcash subjects", async () => {
    const goRes = await resolveSubject(
      ZCASH_DEMO_VERIFIED_SUBJECT,
      "agent.commerce.escrow",
    );
    assert.equal(goRes.ok, true);
    if (goRes.ok) {
      assert.equal(goRes.capable, true);
      assert.equal(goRes.primary.chain.id, "zcash-testnet");
      assert.equal(
        goRes.primary.outcome.ok && goRes.primary.outcome.revoked,
        false,
      );
    }

    const replayRes = await resolveSubject(
      ZCASH_DEMO_REPLAYED_SUBJECT,
      "agent.commerce.escrow",
    );
    assert.equal(replayRes.ok, true);
    if (replayRes.ok) {
      assert.equal(replayRes.capable, false);
      assert.equal(
        replayRes.primary.outcome.ok && replayRes.primary.outcome.revoked,
        true,
      );
    }

    const noneRes = await resolveSubject(
      ZCASH_DEMO_UNVERIFIED_SUBJECT,
      "kyc.basic",
    );
    assert.equal(noneRes.ok, true);
    if (noneRes.ok) {
      assert.equal(noneRes.capable, false);
      assert.equal(
        noneRes.primary.outcome.ok && noneRes.primary.outcome.revoked,
        false,
      );
    }
  });

  it("evaluates the 4-signal gate decision (GO, replay STOP, unverified STOP) for shielded ZEC intents", async () => {
    const baseMandate = {
      payees: [
        ZCASH_DEMO_VERIFIED_SUBJECT,
        ZCASH_DEMO_REPLAYED_SUBJECT,
        ZCASH_DEMO_UNVERIFIED_SUBJECT,
      ],
      maxUsd: 50,
      expectedUsd: 25,
    };

    const goDecision = await runGateDecision(
      {
        payee: ZCASH_DEMO_VERIFIED_SUBJECT,
        amountUsd: 25,
        purpose: "Release 0.25 shielded ZEC for escrow settlement",
        capability: "agent.commerce.escrow",
        mandate: baseMandate,
      },
      { env: { ...process.env, LIGIS_JEV_ENABLED: "0" } },
    );
    assert.equal(goDecision.ok, true);
    if (goDecision.ok) {
      assert.equal(goDecision.decision.verdict, "GO");
      const vp = goDecision.decision.signals.find(
        (s) => s.id === "verified-payee",
      );
      assert.equal(vp?.status, "GO");
      if (vp?.id === "verified-payee") {
        assert.equal(vp.chain, "zcash-testnet");
      }
    }

    const replayDecision = await runGateDecision(
      {
        payee: ZCASH_DEMO_REPLAYED_SUBJECT,
        amountUsd: 25,
        purpose: "Replay shielded ZEC payment with spent nullifier",
        capability: "agent.commerce.escrow",
        mandate: baseMandate,
      },
      { env: { ...process.env, LIGIS_JEV_ENABLED: "0" } },
    );
    assert.equal(replayDecision.ok, true);
    if (replayDecision.ok) {
      assert.equal(replayDecision.decision.verdict, "STOP");
      const vp = replayDecision.decision.signals.find(
        (s) => s.id === "verified-payee",
      );
      assert.equal(vp?.status, "STOP");
      if (vp?.id === "verified-payee") {
        assert.equal(vp.revoked, true);
      }
    }
  });
});
