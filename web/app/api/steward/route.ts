import { NextRequest } from "next/server";
import type { StewardEvent } from "@/lib/steward-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASON_TEXT = `The goal calls for an agent that participates in escrow-backed
commerce and can swap between approved venues. Two reference capabilities cover
that intent: agent.commerce.escrow and agent.commerce.swap. The accredited
investor capability is not strictly required for the stated goal.`;

const DETECTED = ["agent.commerce.escrow", "agent.commerce.swap"];

function fakeTx() {
  const hex = "0123456789abcdef";
  let out = "0x";
  for (let i = 0; i < 64; i++) out += hex[Math.floor(Math.random() * 16)];
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function encode(event: StewardEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

async function* simulateLoop(_goal: string): AsyncGenerator<StewardEvent> {
  yield { type: "phase", phase: "BOOT", status: "start" };
  await sleep(450);
  yield { type: "phase", phase: "BOOT", status: "done" };

  yield { type: "phase", phase: "REASON", status: "start" };
  for (const chunk of REASON_TEXT.split(/(\s+)/)) {
    await sleep(35 + Math.random() * 40);
    yield { type: "delta", phase: "REASON", text: chunk };
  }
  await sleep(200);
  yield { type: "phase", phase: "REASON", status: "done" };

  yield { type: "phase", phase: "GATE", status: "start" };
  for (const name of [
    "agent.commerce.escrow",
    "agent.commerce.swap",
    "rwa.accredited",
  ]) {
    await sleep(380);
    yield {
      type: "capability",
      phase: "GATE",
      name,
      capable: name === "agent.commerce.swap",
    };
  }
  yield { type: "phase", phase: "GATE", status: "done" };

  await sleep(400);
  yield { type: "phase", phase: "ACT", status: "start" };
  for (const name of DETECTED.filter((n) => n !== "agent.commerce.swap")) {
    await sleep(900);
    yield { type: "tx", phase: "ACT", name, txHash: fakeTx() };
  }
  yield { type: "phase", phase: "ACT", status: "done" };

  yield { type: "phase", phase: "RECORD", status: "start" };
  await sleep(1400);
  yield {
    type: "manifest",
    phase: "RECORD",
    rootHash: fakeTx(),
    anchorTx: fakeTx(),
  };
  yield { type: "phase", phase: "RECORD", status: "done" };

  yield { type: "summary", ok: true, tokenId: "341" };
}

export async function POST(req: NextRequest) {
  let body: { goal?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const goal = (body.goal ?? "").trim() || "Operate as a Pharos agent.";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of simulateLoop(goal)) {
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
