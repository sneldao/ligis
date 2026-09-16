"""Direct-mode unit tests for JobEscrow (no Studio / Docker needed).

Run:  pip install -r requirements.txt && pytest tests/direct/ -v

These exercise the deterministic logic (gate enforcement, role checks, state
transitions) and the non-deterministic resolve() with mocked web + LLM.
"""

import json

import pytest

from tests.direct.conftest import to_address, to_hex

CONTRACT = "contracts/JobEscrow.py"
CAP = "agent.commerce.escrow"

GATE_GO = json.dumps({
    "subject": "account-hash-seller-demo",
    "capability": CAP,
    "capable": True,
    "ligis_chain": "casper-testnet",
    "proof_ref": "0xligis-tx-go",
    "checked_at": 1700000000,
})

GATE_STOP = json.dumps({
    "subject": "account-hash-untrusted",
    "capability": CAP,
    "capable": False,
    "ligis_chain": "casper-testnet",
    "proof_ref": "0xligis-tx-stop",
    "checked_at": 1700000000,
})

GATE_WRONG_CAP = json.dumps({
    "subject": "account-hash-seller-demo",
    "capability": "rwa.accredited",
    "capable": True,
    "ligis_chain": "casper-testnet",
    "proof_ref": "0xligis-tx",
    "checked_at": 1700000000,
})

BRIEF = "Deliver a 3-page market brief on GenLayer SDK adoption."
EVIDENCE_URL = "https://example.com/deliverable.md"
EVIDENCE_BODY = b"# GenLayer SDK Adoption Market Brief\n\nGenLayer SDK adoption is growing... full 3 pages here."


def _create_job(direct_vm, direct_deploy, buyer, seller, gate=GATE_GO, value=10**18, cap=CAP):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = buyer
    direct_vm.value = value
    job_id = contract.create_job(to_address(seller), BRIEF, cap, gate)
    direct_vm.value = 0
    return contract, job_id


def test_gate_go_creates_job(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert int(job_id) == 1
    job = json.loads(contract.get_job(job_id))
    assert job["status"] == "open"
    assert job["buyer"] == to_hex(direct_alice)
    assert job["seller"] == to_hex(direct_bob)
    assert job["required_capability"] == CAP
    assert int(job["stake"]) == 10**18


def test_gate_stop_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    with direct_vm.expect_revert("Ligis gate STOP"):
        _create_job(direct_vm, direct_deploy, direct_alice, direct_bob, gate=GATE_STOP)


def test_gate_capability_mismatch_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    with direct_vm.expect_revert("gate capability mismatch"):
        _create_job(direct_vm, direct_deploy, direct_alice, direct_bob, gate=GATE_WRONG_CAP)


def test_zero_stake_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    with direct_vm.expect_revert("must lock a stake"):
        _create_job(direct_vm, direct_deploy, direct_alice, direct_bob, value=0)


def test_gate_receipt_stored_onchain(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    receipt = json.loads(contract.get_gate_receipt(job_id))
    assert receipt["capable"] is True
    assert receipt["ligis_chain"] == "casper-testnet"
    assert receipt["proof_ref"] == "0xligis-tx-go"
    assert contract.is_eligible(job_id) is True


def test_submit_delivery_and_dispute(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)

    # only seller may deliver
    direct_vm.sender = direct_bob
    contract.submit_delivery(job_id, EVIDENCE_URL)
    assert json.loads(contract.get_job(job_id))["status"] == "delivered"

    # only buyer may dispute
    direct_vm.sender = direct_alice
    contract.open_dispute(job_id, "Not a market brief.")
    assert json.loads(contract.get_job(job_id))["status"] == "disputed"


def test_wrong_role_delivery_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice  # buyer tries to deliver
    with direct_vm.expect_revert("only the seller may deliver"):
        contract.submit_delivery(job_id, EVIDENCE_URL)


def test_resolve_approved(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(job_id, EVIDENCE_URL)
    direct_vm.sender = direct_alice
    contract.open_dispute(job_id, "Not a market brief.")

    direct_vm.mock_web(r".*example\.com.*", {"status": 200, "body": EVIDENCE_BODY})
    direct_vm.mock_llm(
        r".*adjudicator.*",
        json.dumps({"verdict": "APPROVED", "reasoning": "Deliverable is a 3-page brief."}),
    )

    status = contract.resolve(job_id)
    assert status == "resolved_release"
    job = json.loads(contract.get_job(job_id))
    assert job["verdict_summary"] == "Deliverable is a 3-page brief."


def test_resolve_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(job_id, EVIDENCE_URL)
    direct_vm.sender = direct_alice
    contract.open_dispute(job_id, "Just a README, not a brief.")

    direct_vm.mock_web(r".*example\.com.*", {"status": 200, "body": b"# README\nnot a brief"})
    direct_vm.mock_llm(
        r".*adjudicator.*",
        json.dumps({"verdict": "REJECTED", "reasoning": "Deliverable is a README, not a brief."}),
    )

    status = contract.resolve(job_id)
    assert status == "resolved_refund"


def test_claim_after_release_pays_seller(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(job_id, EVIDENCE_URL)
    direct_vm.sender = direct_alice
    contract.open_dispute(job_id, "dispute")

    direct_vm.mock_web(r".*example\.com.*", {"status": 200, "body": EVIDENCE_BODY})
    direct_vm.mock_llm(r".*adjudicator.*", json.dumps({"verdict": "APPROVED", "reasoning": "ok"}))
    contract.resolve(job_id)

    contract.claim(job_id)
    job = json.loads(contract.get_job(job_id))
    assert job["claimed"] is True


def test_double_claim_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(job_id, EVIDENCE_URL)
    direct_vm.sender = direct_alice
    contract.open_dispute(job_id, "dispute")
    direct_vm.mock_web(r".*example\.com.*", {"status": 200, "body": EVIDENCE_BODY})
    direct_vm.mock_llm(r".*adjudicator.*", json.dumps({"verdict": "APPROVED", "reasoning": "ok"}))
    contract.resolve(job_id)
    contract.claim(job_id)
    with direct_vm.expect_revert("already claimed"):
        contract.claim(job_id)


def test_cancel_open_job(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, job_id = _create_job(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    contract.cancel_job(job_id)
    assert json.loads(contract.get_job(job_id))["status"] == "resolved_refund"
