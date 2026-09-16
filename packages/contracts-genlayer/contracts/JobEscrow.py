# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json
from dataclasses import dataclass

import genlayer as gl
from genlayer.types import *  # u256, Address, etc.


# ---------------------------------------------------------------------------
# Storage types
# ---------------------------------------------------------------------------

@gl.storage.allow
@dataclass
class GateReceipt:
    """Ligis pre-flight eligibility proof (Stream 0 schema, v1)."""
    subject: str
    capability: str
    capable: bool
    ligis_chain: str
    proof_ref: str
    checked_at: u256
    capability_hash: str


@gl.storage.allow
@dataclass
class Job:
    """A single escrow job. One contract instance holds many jobs (TreeMap)."""
    id: u256
    buyer: Address
    seller: Address
    brief: str
    stake: u256
    status: str
    evidence_uri: str
    dispute_reason: str
    verdict_summary: str
    required_capability: str
    subject: str
    created_at: u256
    delivered_at: u256
    disputed_at: u256
    resolved_at: u256
    claimed: bool


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise Exception(msg)


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------

class JobEscrow(gl.contract.Contract):
    """Credential-gated escrow with AI adjudication of disputed delivery."""

    next_job_id: u256
    jobs: gl.storage.TreeMap[u256, Job]
    gate_receipts: gl.storage.TreeMap[u256, GateReceipt]

    def __init__(self) -> None:
        self.next_job_id = u256(1)

    # -- creation (gate-enforced) ------------------------------------------

    @gl.public.write.payable
    def create_job(
        self,
        seller: str,
        brief: str,
        required_capability: str,
        gate_receipt_json: str,
    ) -> u256:
        """Open + fund a job. Only succeeds if the Ligis gate said GO."""
        _require(gl.message.value > u256(0), "must lock a stake")

        receipt = json.loads(gate_receipt_json)
        _require(receipt.get("capable") is True, "Ligis gate STOP: subject not capable")
        _require(receipt.get("capability") == required_capability, "gate capability mismatch")

        seller_addr = Address(seller)
        job_id = self.next_job_id
        self.next_job_id = job_id + u256(1)

        job = Job(
            id=job_id,
            buyer=gl.message.sender_address,
            seller=seller_addr,
            brief=brief,
            stake=gl.message.value,
            status="open",
            evidence_uri="",
            dispute_reason="",
            verdict_summary="",
            required_capability=required_capability,
            subject=str(receipt.get("subject", "")),
            created_at=u256(0),
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
        self.jobs[job_id] = job

    # -- adjudication (Intelligent, load-bearing) --------------------------

    @gl.public.write
    def resolve(self, job_id: u256) -> str:
        """AI-jury verdict on a disputed delivery. disputed -> resolved_*."""
        job = self.jobs[job_id]
        _require(job.status == "disputed", "job is not disputed")

        brief = job.brief
        evidence_uri = job.evidence_uri
        dispute_reason = job.dispute_reason

        def judge_delivery() -> str:
            evidence_text = ""
            if evidence_uri.startswith("http"):
                try:
                    evidence_text = gl.nondet.web.render(evidence_uri, mode="text")[:8000]
                except Exception:
                    evidence_text = ""

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
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            return json.dumps(result, sort_keys=True)

        verdict_json = gl.eq_principle.strict_eq(judge_delivery)
        verdict_data = json.loads(verdict_json)
        verdict = verdict_data.get("verdict", "REJECTED")
        reasoning = verdict_data.get("reasoning", "")

        job.status = "resolved_release" if verdict == "APPROVED" else "resolved_refund"
        job.verdict_summary = reasoning
        self.jobs[job_id] = job
        return job.status

    # -- settlement --------------------------------------------------------

    @gl.public.write
    def claim(self, job_id: u256) -> None:
        """Pay out the locked stake per the terminal status."""
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

        gl.chain.Account(recipient).emit_transfer(value=stake)

    @gl.public.write
    def cancel_job(self, job_id: u256) -> None:
        """Buyer cancels an open job and reclaims the stake."""
        job = self.jobs[job_id]
        _require(job.status == "open", "can only cancel open jobs")
        _require(gl.message.sender_address == job.buyer, "only the buyer may cancel")

        stake = job.stake
        job.status = "resolved_refund"
        job.claimed = True
        self.jobs[job_id] = job

        gl.chain.Account(job.buyer).emit_transfer(value=stake)

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
