/**
 * `POST /api/zk/demo-proof` `{ scenario: "holder" | "revoked" }` — prove a
 * public demo credential live (nargo + bb) and return a `zkProof` ready for
 * `POST /api/gate`. Only enabled when the gate trusts the demo registry
 * (`LIGIS_ZK_ROOT_MANIFEST=demo`). Fixture secrets only; no real identity.
 */
import { NextRequest, NextResponse } from "next/server";
import { runDemoProof } from "@/lib/zk-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { scenario?: unknown };
  const out = await runDemoProof(process.env, body.scenario);
  return out.ok
    ? NextResponse.json(out.proof, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: out.error }, { status: out.status });
}
