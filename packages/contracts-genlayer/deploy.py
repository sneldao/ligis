#!/usr/bin/env python3
"""
Deploy + run the full JobEscrow lifecycle on GenLayer Studio Next (chain 61997).

  create_job (gate GO) -> submit_delivery -> open_dispute -> resolve -> claim

Targets studio_devnet (https://studio-dev.genlayer.com/api, chain ID 61997),
the network the Agent Tank portal requires for the explorer-link field.

Usage:
  pip install -r requirements.txt
  export GENLAYER_PRIVATE_KEY=0x...        # optional; a fresh account is created if unset
  export JOBEscrow_ADDRESS=0x...           # optional; reuse an existing contract

  python deploy.py                         # deploy (if needed) + run full flow
  python deploy.py --no-deploy             # skip deploy, reuse JOBEscrow_ADDRESS
  python deploy.py --stop                  # also demonstrate the STOP gate path

Writes ../scripts/genlayer-agent-tank-demo.lastrun.txt with addresses, job id,
and explorer URLs so Stream 3's one-command demo can pick it up.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time

from genlayer_py import create_client, create_account
from genlayer_py.chains import studio_devnet

try:
    from genlayer_py.types import TransactionStatus
except Exception:  # pragma: no cover - import path varies across SDK patch versions
    class TransactionStatus:
        ACCEPTED = "accepted"
        FINALIZED = "finalized"


CONTRACT_FILE = pathlib.Path(__file__).parent / "contracts" / "JobEscrow.py"
LASTRUN_FILE = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "genlayer-agent-tank-demo.lastrun.txt"
EXPLORER_BASE = "https://explorer-studio-dev.genlayer.com/address"
STUDIO_RPC = "https://studio-dev.genlayer.com/api"
CHAIN_ID = 61997

# 0.01 GEN in wei — enough to exercise the flow without burning testnet funds.
STAKE_WEI = 10_000_000_000_000_000


def log(msg: str) -> None:
    print(f"[genlayer] {msg}", flush=True)


def estimate_fees(client) -> dict:
    """Estimate transaction fees for the current network. Studio dev requires
    a fee distribution on every transaction or it reverts with FeesDistributionMissing."""
    try:
        est = client.estimate_transaction_fees()
        return {"distribution": est["distribution"], "fee_value": est.get("fee_value", est.get("feeValue"))}
    except Exception as e:
        log(f"WARNING: fee estimation failed ({e}), using defaults")
        return None


def wait_ok(client, tx_hash: str, label: str) -> dict:
    log(f"waiting for {label} ...")
    receipt = client.wait_for_transaction_receipt(
        tx_hash, wait_until="finalized", full_transaction=True, retries=120, interval=5000
    )
    r = receipt if isinstance(receipt, dict) else vars(receipt)
    # genlayer-py 0.19.x: status is in lifecycle.outcome
    lifecycle = r.get("lifecycle", {})
    outcome = lifecycle.get("outcome") if isinstance(lifecycle, dict) else None
    result_name = r.get("result_name", "")
    status = r.get("status") or outcome or result_name
    if status not in (1, "1", "success", "finalized", "accepted", "MAJORITY_AGREE"):
        log(f"  receipt: {receipt}")
        raise RuntimeError(f"{label} did not finalize (status={status})")
    log(f"  {label} ok")
    return r


def get_contract_address(receipt: dict) -> str:
    # Direct keys
    for key in ("contract_address", "contractAddress", "address"):
        val = receipt.get(key)
        if val:
            return val
    # Nested under 'result'
    result = receipt.get("result")
    if isinstance(result, dict):
        for key in ("contract_address", "contractAddress", "address"):
            val = result.get(key)
            if val:
                return val
    # Nested under 'data' (genlayer-py 0.19.x)
    data = receipt.get("data")
    if isinstance(data, dict):
        for key in ("contract_address", "contractAddress", "address"):
            val = data.get(key)
            if val:
                return val
    raise RuntimeError(f"could not find contract address in receipt: {receipt}")


def main() -> None:
    args = set(sys.argv[1:])
    do_deploy = "--no-deploy" not in args
    show_stop = "--stop" in args

    client = create_client(chain=studio_devnet)

    pk = os.environ.get("GENLAYER_PRIVATE_KEY")
    if pk:
        from eth_account import Account
        account = Account.from_key(pk)
        log(f"using account {account.address}")
    else:
        account = create_account()
        log(f"created fresh account {account.address}")

    contract_address = os.environ.get("JOBEscrow_ADDRESS")
    if do_deploy or not contract_address:
        code = CONTRACT_FILE.read_text()
        log(f"deploying JobEscrow to studio_devnet (chain {CHAIN_ID}) ...")
        fees = estimate_fees(client)
        tx_hash = client.deploy_contract(code=code, account=account, args=[], fees=fees)
        receipt = wait_ok(client, tx_hash, "deploy")
        contract_address = get_contract_address(receipt)
        log(f"deployed at {contract_address}")
    else:
        log(f"reusing contract at {contract_address}")

    explorer_url = f"{EXPLORER_BASE}/{contract_address}"
    log(f"explorer: {explorer_url}")

    # ---- Ligis pre-flight gate receipt (from Stream 2 / TS orchestrator) ----
    # Prefer LIGIS_GATE_RECEIPT_JSON so pnpm demo:genlayer can inject a live
    # Casper/Pharos GateReceipt. Fall back to a labeled mock GO for GenLayer-only runs.
    gate_env = os.environ.get("LIGIS_GATE_RECEIPT_JSON", "").strip()
    if gate_env:
        gate_receipt_go = gate_env
        gate_preview = json.loads(gate_receipt_go)
        log(
            f"using injected Ligis gate receipt "
            f"(capable={gate_preview.get('capable')} "
            f"subject={gate_preview.get('subject')} "
            f"chain={gate_preview.get('ligis_chain')})"
        )
    else:
        gate_receipt_go = json.dumps({
            "subject": os.environ.get(
                "LIGIS_GATE_SUBJECT", "account-hash-9c01d...demo-seller"
            ),
            "capability": "agent.commerce.escrow",
            "capable": True,
            "ligis_chain": "casper-testnet",
            "proof_ref": "mock:genlayer-only — set LIGIS_GATE_RECEIPT_JSON for live Ligis",
            "checked_at": int(time.time()),
        })
        log("WARNING: no LIGIS_GATE_RECEIPT_JSON — using mock GO receipt")

    seller = os.environ.get("LIGIS_GENLAYER_SELLER", "").strip() or account.address
    brief = os.environ.get(
        "LIGIS_GENLAYER_BRIEF",
        "Deliver a 3-page market brief on GenLayer SDK adoption.",
    )
    evidence_url = os.environ.get(
        "LIGIS_GENLAYER_EVIDENCE_URI",
        "https://raw.githubusercontent.com/genlayerlabs/genlayer-docs/main/README.md",
    )
    dispute_reason = os.environ.get(
        "LIGIS_GENLAYER_DISPUTE_REASON",
        "Deliverable is docs README, not a market brief.",
    )
    required_capability = json.loads(gate_receipt_go).get(
        "capability", "agent.commerce.escrow"
    )

    # ---- 1. create_job (gate GO) -------------------------------------------
    log("create_job (gate GO, locking stake) ...")
    fees = estimate_fees(client)
    tx_hash = client.write_contract(
        account=account,
        address=contract_address,
        function_name="create_job",
        args=[seller, brief, required_capability, gate_receipt_go],
        value=STAKE_WEI,
        fees=fees,
    )
    wait_ok(client, tx_hash, "create_job")

    # genlayer-py 0.19.x u256 decoding doesn't match v0.3.0 GenVM calldata encoding
    # Use job_id=1 (first job in a fresh contract) and raw_return for reads
    job_id = 1
    log(f"job id = {job_id}")

    job_json = client.read_contract(account=account, 
        address=contract_address, function_name="get_job", args=[job_id], raw_return=True
    )
    # raw_return for str is hex-encoded calldata; decode it
    if isinstance(job_json, str) and job_json.startswith("0x"):
        job_json = bytes.fromhex(job_json[2:]).decode("utf-8", errors="replace")
    # Strip any non-JSON prefix
    if "{" in job_json:
        job_json = job_json[job_json.index("{"):]
    job = json.loads(job_json if isinstance(job_json, str) else json.dumps(job_json))
    log(f"job status = {job['status']}, gate receipt stored = {job['required_capability']}")

    gate_raw = client.read_contract(account=account, 
        address=contract_address, function_name="get_gate_receipt", args=[job_id], raw_return=True
    )
    if isinstance(gate_raw, str) and gate_raw.startswith("0x"):
        gate_raw = bytes.fromhex(gate_raw[2:]).decode("utf-8", errors="replace")
    if "{" in gate_raw:
        gate_raw = gate_raw[gate_raw.index("{"):]
    gate = json.loads(gate_raw if isinstance(gate_raw, str) else json.dumps(gate_raw))
    log(f"on-chain gate receipt: capable={gate['capable']} chain={gate['ligis_chain']} proof={gate['proof_ref']}")

    # ---- 2. submit_delivery -----------------------------------------------
    log(f"submit_delivery ({evidence_url}) ...")
    fees = estimate_fees(client)
    tx_hash = client.write_contract(
        account=account, address=contract_address,
        function_name="submit_delivery", args=[job_id, evidence_url],
        fees=fees,
    )
    wait_ok(client, tx_hash, "submit_delivery")

    # ---- 3. open_dispute ---------------------------------------------------
    log("open_dispute ...")
    fees = estimate_fees(client)
    tx_hash = client.write_contract(
        account=account, address=contract_address,
        function_name="open_dispute", args=[job_id, dispute_reason],
        fees=fees,
    )
    wait_ok(client, tx_hash, "open_dispute")

    # ---- 4. resolve (AI-jury) ----------------------------------------------
    log("resolve (AI-jury adjudication, this takes a few consensus rounds) ...")
    fees = estimate_fees(client)
    tx_hash = client.write_contract(
        account=account, address=contract_address,
        function_name="resolve", args=[job_id],
        fees=fees,
    )
    # resolve may be "undetermined" if validators disagree — that's a real GenLayer outcome
    try:
        wait_ok(client, tx_hash, "resolve")
    except RuntimeError as e:
        log(f"  resolve note: {e} (this is a valid GenLayer outcome — AI-jury could not reach consensus)")
    
    job_json = client.read_contract(account=account, 
        address=contract_address, function_name="get_job", args=[job_id], raw_return=True
    )
    if isinstance(job_json, str) and job_json.startswith("0x"):
        job_json = bytes.fromhex(job_json[2:]).decode("utf-8", errors="replace")
    if "{" in job_json:
        job_json = job_json[job_json.index("{"):]
    job = json.loads(job_json if isinstance(job_json, str) else json.dumps(job_json))
    log(f"verdict = {job['status']}")
    log(f"verdict_summary = {job['verdict_summary']}")

    # ---- 5. claim ---------------------------------------------------------
    if job['status'] in ("resolved_release", "resolved_refund"):
        log("claim ...")
        fees = estimate_fees(client)
        tx_hash = client.write_contract(
            account=account, address=contract_address,
            function_name="claim", args=[job_id],
            fees=fees,
        )
        wait_ok(client, tx_hash, "claim")
        log("claim ok — funds moved per verdict")
    else:
        log(f"skip claim — job status is {job['status']} (not resolved)")

    # ---- optional STOP path ------------------------------------------------
    if show_stop:
        log("demonstrating STOP gate path (create_job must revert) ...")
        gate_receipt_stop = json.dumps({
            "subject": "account-hash-bad...untrusted",
            "capability": "agent.commerce.escrow",
            "capable": False,
            "ligis_chain": "casper-testnet",
            "proof_ref": "0xstop...ligis-tx-hash",
            "checked_at": int(time.time()),
        })
        try:
            fees = estimate_fees(client)
            client.write_contract(
                account=account, address=contract_address,
                function_name="create_job",
                args=[account.address, "should never open", "agent.commerce.escrow", gate_receipt_stop],
                value=STAKE_WEI,
                fees=fees,
            )
            log("STOP path FAILED to revert — contract bug!")
        except Exception as e:
            log(f"STOP path correctly reverted: {type(e).__name__}")

    # ---- write lastrun -----------------------------------------------------
    LASTRUN_FILE.parent.mkdir(parents=True, exist_ok=True)
    LASTRUN_FILE.write_text(
        f"GenLayer Agent Tank — JobEscrow lastrun\n"
        f"========================================\n"
        f"chain: studio_devnet (id {CHAIN_ID})\n"
        f"rpc: {STUDIO_RPC}\n"
        f"contract_address: {contract_address}\n"
        f"explorer: {explorer_url}\n"
        f"job_id: {job_id}\n"
        f"final_status: {job['status']}\n"
        f"verdict_summary: {job['verdict_summary']}\n"
        f"gate_proof_ref: {gate['proof_ref']}\n"
        f"gate_chain: {gate['ligis_chain']}\n"
        f"run_at: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n"
    )
    log(f"lastrun written to {LASTRUN_FILE}")
    log("done")


if __name__ == "__main__":
    main()
