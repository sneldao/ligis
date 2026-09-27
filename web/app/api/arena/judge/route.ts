import { NextResponse } from "next/server";
import { judgePayment } from "@/lib/arena/judge";
import { PAYMENTS, isCustomAttack, type PaymentId } from "@/lib/arena/scenario";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;

export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  let body: { payment?: unknown; custom?: unknown } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  let input: PaymentId | Parameters<typeof judgePayment>[0] | null = null;
  if (typeof body?.payment === "string" && body.payment in PAYMENTS) {
    input = body.payment as PaymentId;
  } else if (isCustomAttack(body?.custom)) {
    const { amountUsd, payee, instruction } = body.custom;
    input = { amountUsd, payee, instruction: instruction.trim() };
  }
  if (!input) {
    return NextResponse.json({ error: "invalid payment" }, { status: 400 });
  }

  const result = await judgePayment(input, ip);
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
