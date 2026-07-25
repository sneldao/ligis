import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Address } from "viem";
import { getChain } from "@/lib/network";
import {
  readAgentSnapshot,
  readCapabilityHistory,
  capabilities,
  isValidAddress,
  isCasperChain,
} from "@/lib/chain-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: raw } = await params;
  const chainParam = req.nextUrl.searchParams.get("chain") ?? "casper-testnet";
  const chain = getChain({ chain: chainParam });

  if (!isValidAddress(chain, raw)) {
    return NextResponse.json(
      { error: `Invalid address for ${chain.name}. Expected ${isCasperChain(chain) ? "account-hash-... or public key hex" : "0x-prefixed 20-byte address"}.` },
      { status: 400 }
    );
  }
  try {
    const subject = isCasperChain(chain) ? raw : (getAddress(raw) as Address);
    const [snap, history] = await Promise.all([
      readAgentSnapshot(chain, subject),
      readCapabilityHistory(chain, subject),
    ]);

    const capMap = new Map(capabilities.map((c) => [c.hash.toLowerCase(), c.id]));

    return NextResponse.json(
      {
        address: subject,
        chain: chain.id,
        exists: snap.exists,
        tokenId: snap.tokenId.toString(),
        controller: snap.controller,
        held: snap.held.map((h) => ({
          id: h.capability.id,
          label: h.capability.label,
        })),
        heldCount: snap.held.length,
        history: history.map((h) => ({
          capability: capMap.get(h.capabilityHash.toLowerCase()) ?? h.capabilityHash,
          capable: h.capable,
          block: h.blockNumber.toString(),
          txHash: h.txHash,
        })),
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
