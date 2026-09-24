import { NextRequest, NextResponse } from "next/server";
import { listAgents } from "@/lib/list-agents";
import { getChain } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live AgentId controllers for the field catalog. */
export async function GET(req: NextRequest) {
  const chainParam = req.nextUrl.searchParams.get("chain") ?? "casper-testnet";
  const chain = getChain({ chain: chainParam });
  try {
    const agents = await listAgents(chain);
    return NextResponse.json(
      {
        chain: chain.id,
        count: agents.length,
        agents: agents.map((a) => ({
          address: a.address,
          tokenId: a.tokenId,
          origin: "live" as const,
        })),
      },
      { headers: { "Cache-Control": "public, max-age=30" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
