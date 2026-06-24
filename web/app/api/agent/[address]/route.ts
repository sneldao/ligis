import { NextResponse } from "next/server";
import { getAddress, type Address } from "viem";
import { readAgentSnapshot } from "@/lib/chain";
import { isAddressLike } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: raw } = await params;
  if (!isAddressLike(raw)) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }
  try {
    const subject = getAddress(raw) as Address;
    const snap = await readAgentSnapshot(subject);
    return NextResponse.json(
      {
        address: subject,
        exists: snap.exists,
        tokenId: snap.tokenId.toString(),
        controller: snap.controller,
        held: snap.held.map((h) => ({
          id: h.capability.id,
          label: h.capability.label,
        })),
        heldCount: snap.held.length,
      },
      { headers: { "Cache-Control": "public, max-age=15" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
