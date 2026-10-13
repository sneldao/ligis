import "server-only";
import { authenticateOutcomeCaller } from "./auth";
import { loadOutcomeRuntime } from "./runtime";

const response = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function handleOutcomePost(
  request: Request,
  runtime: ReturnType<typeof loadOutcomeRuntime> = loadOutcomeRuntime(),
): Promise<Response> {
  if (request.method !== "POST")
    return response({ stored: false, reason: "method-not-allowed" }, 405);
  if (!runtime) return response({ stored: false, reason: "disabled" }, 404);
  if (!authenticateOutcomeCaller(request.headers, runtime.grants))
    return response({ stored: false, reason: "unauthorized" }, 401);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    return response({ stored: false, reason: "json-required" }, 415);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 2048))
    return response({ stored: false, reason: "oversized" }, 413);
  const reader = request.body?.getReader();
  if (!reader)
    return response({ stored: false, reason: "invalid-submission" }, 400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2048) throw Error("oversized");
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel();
          reject(Error("body-timeout"));
        }, 2000);
      }),
    ]);
    const result = await runtime.recorder.ingest(
      JSON.parse(text),
      request.headers,
    );
    return response(result, result.stored ? 200 : result.status);
  } catch (error) {
    const oversized = error instanceof Error && error.message === "oversized";
    return response(
      { stored: false, reason: oversized ? "oversized" : "invalid-submission" },
      oversized ? 413 : 400,
    );
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
