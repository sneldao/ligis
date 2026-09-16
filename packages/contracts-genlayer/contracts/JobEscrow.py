# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""
JobEscrow — Ligis x GenLayer Agent Tank
=======================================

Credential-gated agent commerce with Intelligent Contract adjudication.

  Ligis decides WHO may trade  (deterministic gate, off-chain pre-flight, Option A)
  GenLayer decides WHAT happened (non-deterministic AI-jury verdict on disputed delivery)

Lifecycle (status enum, locked by Stream 0):

  open -> delivered -> disputed -> resolved_release | resolved_refund
                                    --> claim() pays out per terminal status

The gate is enforced in create_job(): the caller must supply a Ligis GateReceipt
(JSON, produced by the off-chain Ligis pre-flight check) whose `capable` field is
True and whose `capability` matches the job's `required_capability`. The receipt
is stored on-chain so the panel can SEE Ligis in contract state, not only in the
video voiceover. This is the "visible Ligis call" the win plan requires.

Judgment is load-bearing: resolve() fetches the deliverable from the web and asks
an LLM to compare it against the brief. If you removed the LLM/web step the product
collapses — there is no deterministic fallback for "was it good enough?". That is
why this contract lives on GenLayer and not on Casper/Pharos.
"""

from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json


# ---------------------------------------------------------------------------
# Storage types
# ---------------------------------------------------------------------------

@allow_storage
@dataclass
class GateReceipt:
    """Ligis pre-flight eligibility proof (Stream 0 schema, v1).

    Produced off-chain by checkLigisGate({ subject, capability }) and passed
    into create_job() as JSON. Mirrored on-chain for UI / explorer visibility.
    """
    subject: str          # agent / account identifier used in Ligis (account-hash-... / 0x...)
    capability: str        # e.g. agent.commerce.escrow
    capable: bool          # GO / STOP
    ligis_chain: str       # casper-testnet | pharos-atlantic | ...
    proof_ref: str        # tx hash, verify response id, or gate URL
    checked_at: u256       # unix seconds
    capability_hash: str   # optional (0x+keccak256); empty string if not provided


@allow_storage
@dataclass
class Job:
    """A single escrow job. One contract instance holds many jobs (TreeMap)."""
    id: u256
    buyer: Address         # who posted + funded the job (GenLayer address)
    seller: Address        # who must deliver (GenLayer address, named by buyer)
    brief: str             # text or URI describing the work
    stake: u256            # locked GEN, in wei
    status: str            # open | delivered | disputed | resolved_release | resolved_refund
    evidence_uri: str      # deliverable URL submitted by seller
    dispute_reason: str    # buyer's justification for disputing
    verdict_summary: str   # AI-jury reasoning (post resolve)
    required_capability: str
    subject: str           # Ligis subject the gate checked (from receipt)
    created_at: u256
    delivered_at: u256
    disputed_at: u256
    resolved_at: u256
    claimed: bool          # payout already executed


# EOA / EVM-side value transfer interface (used by claim() / cancel_job() payouts).
# GenLayer ICs send native GEN to an EOA through their ghost contract.
@gl.evm.contract_interface
class _Payout:
    class View:
        pass

    class Write:
        pass


def _now() -> u256:
    return u256(int(datetime.now(timezone.utc).timestamp()))


def _require(cond: bool, msg: str) -> None:
    """Revert with a message. Uses raise Exception (not assert) so direct-mode
    tests can catch reverts via expect_revert, and on-chain GenVM rolls back."""
    if not cond:
        raise Exception(msg)


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------

class JobEscrow(gl.Contract):
    """Credential-gated escrow with AI adjudication of disputed delivery."""

    next_job_id: u256
    jobs: TreeMap[u256, Job]
    gate_receipts: TreeMap[u256, GateReceipt]

    def __init__(self) -> None:
        # TreeMap fields auto-initialize to empty; only set the counter start.
        self.next_job_id = u256(1)

    # -- creation (gate-enforced) ------------------------------------------

    @gl.public.write.payable
    def create_job(
        self,
        seller: Address,
        brief: str,
        required_capability: str,
        gate_receipt_json: str,
    ) -> u256:
        """Open + fund a job. Only succeeds if the Ligis gate said GO.

        The gate is NOT re-run here (Ligis is the eligibility source of truth,
        on its own chain). We verify the receipt the caller already obtained:
          - capable == True
          - capability == required_capability
        and store it so the receipt is visible in contract state.
        """
        _require(gl.message.value > u256(0), "must lock a stake")

        receipt = json.loads(gate_receipt_json)
        _require(receipt.get("capable") is True, "Ligis gate STOP: subject not capable")
        _require(receipt.get("capability") == required_capability, "gate capability mismatch")

        job_id = self.next_job_id
        self.next_job_id = job_id + u256(1)

        job = Job(
            id=job_id,
            buyer=gl.message.sender_address,
            seller=seller,
            brief=brief,
            stake=gl.message.value,
            status="open",
            evidence_uri="",
            dispute_reason="",
            verdict_summary="",
            required_capability=required_capability,
            subject=str(receipt.get("subject", "")),
            created_at=_now(),
            delivered_at=u256(0),
            disputed_at=u256(0),
            resolved_at=u256(0),
            claimed=False,
        )
        self.jobs[job_id] = job
        self.gate_receipts[job_id] = GateReceipt(
            subject=str(receipt.get("subject", "")),
            capability=str(receipt.get("capability", "")),
            capable=bool(receipt.get("capable", False)),
            ligis_chain=str(receipt.get("ligis_chain", "")),
            proof_ref=str(receipt.get("proof_ref", "")),
            checked_at=u256(int(receipt.get("checked_at", 0))),
            capability_hash=str(receipt.get("capability_hash", "")),
        )
        return job_id

    # -- delivery + dispute ------------------------------------------------

    @gl.public.write
    def submit_delivery(self, job_id: u256, evidence_uri: str) -> None:
        """Seller submits the deliverable (URL). open -> delivered."""
        job = self.jobs[job_id]
        _require(job.status == "open", "job not open")
        _require(gl.message.sender_address == job.seller, "only the seller may deliver")
        _require(len(evidence_uri) > 0, "evidence uri cannot be empty")

        job.status = "delivered"
        job.evidence_uri = evidence_uri
        job.delivered_at = _now()
        self.jobs[job_id] = job

    @gl.public.write
    def open_dispute(self, job_id: u256, reason: str) -> None:
        """Buyer disputes the delivery. delivered -> disputed."""
        job = self.jobs[job_id]
        _require(job.status == "delivered", "can only dispute a delivered job")
        _require(gl.message.sender_address == job.buyer, "only the buyer may dispute")
        _require(len(reason) > 0, "dispute reason cannot be empty")

        job.status = "disputed"
        job.dispute_reason = reason
        job.disputed_at = _now()
        self.jobs[job_id] = job

    # -- adjudication (Intelligent, load-bearing) --------------------------

    @gl.public.write
    def resolve(self, job_id: u256) -> str:
        """AI-jury verdict on a disputed delivery. disputed -> resolved_*.

        This is the GenLayer-native value: each validator independently fetches
        the deliverable from the web and asks an LLM whether it satisfies the
        brief. Consensus is reached on the binary verdict (APPROVED/REJECTED),
        not on the reasoning — the Equivalence Principle in action.

        Funds are NOT moved here; claim() pays out per the terminal status so
        the state transition is visible in the explorer.
        """
        job = self.jobs[job_id]
        _require(job.status == "disputed", "job is not disputed")

        # Capture deterministic inputs outside the nondet block.
        brief = job.brief
        evidence_uri = job.evidence_uri
        dispute_reason = job.dispute_reason

        def leader_fn():
            # 1. Fetch the deliverable from the web (each validator independently).
            evidence_text = ""
            if evidence_uri.startswith("http"):
                try:
                    evidence_text = gl.nondet.web.render(evidence_uri, mode="text")[:8000]
                except Exception:
                    evidence_text = ""

            # 2. Ask the LLM to judge the deliverable against the brief.
            prompt = (
                "You are an impartial adjudicator for an agent-to-agent job escrow.\n"
                "A buyer hired a seller and locked funds. The seller submitted a deliverable.\n"
                "The buyer disputes the delivery. Decide whether the deliverable satisfies the brief.\n\n"
                f"BRIEF (what the seller agreed to deliver):\n{brief}\n\n"
                f"BUYER DISPUTE REASON:\n{dispute_reason}\n\n"
                f"DELIVERABLE URL: {evidence_uri}\n\n"
                f"DELIVERABLE CONTENT (fetched from the web, may be truncated):\n{evidence_text}\n\n"
                "TASK: Evaluate whether the deliverable reasonably meets the brief.\n"
                "Be strict but fair: minor wording differences are not failures; missing\n"
                "core functionality or contradicting the brief IS a failure.\n\n"
                "Respond as JSON with exactly these fields:\n"
                '{"verdict": "APPROVED" or "REJECTED", "reasoning": "2-3 sentence explanation"}'
            )
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            try:
                my_result = leader_fn()
                leader_verdict = leaders_res.calldata.get("verdict")
                my_verdict = my_result.get("verdict")
                # Equivalence: same binary verdict, reasoning may differ.
                return my_verdict == leader_verdict and my_verdict in ("APPROVED", "REJECTED")
            except Exception:
                return False

        verdict_data = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        verdict = verdict_data.get("verdict", "REJECTED")
        reasoning = verdict_data.get("reasoning", "")

        # Storage writes happen AFTER consensus, in the deterministic context.
        job.status = "resolved_release" if verdict == "APPROVED" else "resolved_refund"
        job.verdict_summary = reasoning
        job.resolved_at = _now()
        self.jobs[job_id] = job
        return job.status

    # -- settlement --------------------------------------------------------

    @gl.public.write
    def claim(self, job_id: u256) -> None:
        """Pay out the locked stake per the terminal status.

        resolved_release -> seller is paid.
        resolved_refund  -> buyer is refunded.
        Idempotent via the `claimed` flag.
        """
        job = self.jobs[job_id]
        _require(job.status in ("resolved_release", "resolved_refund"), "job not resolved")
        _require(not job.claimed, "already claimed")

        if job.status == "resolved_release":
            recipient = job.seller
        else:
            recipient = job.buyer

        stake = job.stake
        job.claimed = True
        self.jobs[job_id] = job

        _Payout(recipient).emit_transfer(value=stake)

    @gl.public.write
    def cancel_job(self, job_id: u256) -> None:
        """Buyer cancels an unfunded-progress open job and reclaims the stake."""
        job = self.jobs[job_id]
        _require(job.status == "open", "can only cancel open jobs")
        _require(gl.message.sender_address == job.buyer, "only the buyer may cancel")

        stake = job.stake
        job.status = "resolved_refund"
        job.claimed = True
        self.jobs[job_id] = job

        _Payout(job.buyer).emit_transfer(value=stake)

    # -- reads -------------------------------------------------------------

    @gl.public.view
    def get_job(self, job_id: u256) -> str:
        """Return a job as JSON (for UI / explorer / orchestrator)."""
        job = self.jobs[job_id]
        return json.dumps({
            "id": int(job.id),
            "buyer": str(job.buyer),
            "seller": str(job.seller),
            "brief": job.brief,
            "stake": int(job.stake),
            "status": job.status,
            "evidence_uri": job.evidence_uri,
            "dispute_reason": job.dispute_reason,
            "verdict_summary": job.verdict_summary,
            "required_capability": job.required_capability,
            "subject": job.subject,
            "created_at": int(job.created_at),
            "delivered_at": int(job.delivered_at),
            "disputed_at": int(job.disputed_at),
            "resolved_at": int(job.resolved_at),
            "claimed": job.claimed,
        })

    @gl.public.view
    def get_gate_receipt(self, job_id: u256) -> str:
        """Return the on-chain Ligis gate receipt for a job as JSON."""
        r = self.gate_receipts[job_id]
        return json.dumps({
            "subject": r.subject,
            "capability": r.capability,
            "capable": r.capable,
            "ligis_chain": r.ligis_chain,
            "proof_ref": r.proof_ref,
            "checked_at": int(r.checked_at),
            "capability_hash": r.capability_hash,
        })

    @gl.public.view
    def is_eligible(self, job_id: u256) -> bool:
        """Mirror of the last gate result for this job (UI convenience)."""
        return self.gate_receipts[job_id].capable

    @gl.public.view
    def job_count(self) -> u256:
        return self.next_job_id - u256(1)
