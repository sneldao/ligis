import { NextResponse } from "next/server";
import { judgePayment } from "@/lib/arena/judge";
import { PAYMENTS, type PaymentId } from "@/lib/arena/scenario";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    payment?: string;
  } | null;
  const id = body?.payment;
  if (!id || !(id in PAYMENTS)) {
    return NextResponse.json({ error: "unknown payment" }, { status: 400 });
  }
  const result = await judgePayment(id as PaymentId);
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
