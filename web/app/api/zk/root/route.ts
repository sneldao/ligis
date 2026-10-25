/**
 * `GET /api/zk/root` — the CredentialRegistry Merkle root(s) this gate
 * trusts for zk credential proofs, plus the published manifest (leaves, as-of
 * time, source) so a holder can compute its Merkle path against exactly this
 * root. Public data only: leaves are Poseidon hashes that reveal neither the
 * subject, the payee, nor the identity secret. Spec: docs/decide-api.md.
 */
import { NextResponse } from "next/server";
import { zkRootInfo } from "@/lib/zk-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await zkRootInfo(process.env), {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
