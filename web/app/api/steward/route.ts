import { NextRequest } from "next/server";
import { stewardLoop, encode } from "@/lib/steward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { goal?: string; live?: boolean } = {};
  try {
    body = await req.json();
  } catch {}
  const goal = (body.goal ?? "").trim() || "Operate as a Pharos agent.";
  const live = body.live === true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stewardLoop(goal, { live })) {
          controller.enqueue(encode(event));
        }
      } catch (err) {
        controller.enqueue(
          encode({
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
