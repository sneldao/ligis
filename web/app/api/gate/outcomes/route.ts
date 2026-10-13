import { handleOutcomePost } from "@/lib/gate-outcomes/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleOutcomePost(request);
}
