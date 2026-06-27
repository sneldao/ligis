import { NextRequest } from "next/server";
import { stewardLoop } from "@/lib/steward";
import { stewardLoopCasper } from "@/lib/steward-casper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { goal?: string; live?: boolean; chain?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const goal = (body.goal ?? "").trim() || "Operate as a Pharos agent.";
  const live = body.live === true;
  const chain = body.chain ?? "pharos-atlantic";
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const isCasper = chain === "casper-testnet";
  const enc = (event: any): Uint8Array =>
    new TextEncoder().encode(JSON.stringify(event) + "\n");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const gen = isCasper
          ? stewardLoopCasper(goal, { live, clientIp })
          : stewardLoop(goal, { live, clientIp });
        for await (const event of gen) {
          controller.enqueue(enc(event));
        }
      } catch (err) {
        controller.enqueue(
          enc({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          })
        );
      } finally {
        controller.close();
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
