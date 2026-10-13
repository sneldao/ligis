import { NextRequest } from "next/server";
import { type Hex } from "viem";
import { fixtureEnabled, passkeyConfig } from "@/lib/passkey";
import {
  authenticatePasskeyUser,
  fixtureAdmit,
  fixtureLogin,
  fixturePrepare,
  fixtureSubmit,
} from "@/lib/passkey-sponsor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function hex(value: unknown, length?: number): Hex {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(value) ||
    value.length > 4098 ||
    (length !== undefined && value.length !== 2 + length * 2)
  ) {
    throw new Error("Invalid hex");
  }
  return value as Hex;
}
function uint(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value))
    throw new Error("Invalid uint");
  const number = BigInt(value);
  if (number >= 1n << 256n) throw new Error("Invalid uint");
  return number;
}
async function bodyOf(req: NextRequest): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(value);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid body");
  return parsed;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await bodyOf(req);
  } catch {
    return json(
      { error: "Expected a JSON object no larger than 16 KiB." },
      400,
    );
  }
  const action = body.action;
  if (action === "config") return json(await passkeyConfig());
  if (action === "enroll") {
    return json(
      {
        error:
          "Public enrollment is forbidden. Only the contract owner may admit an operator key. All admitted keys share issuer authority.",
      },
      403,
    );
  }
  if (typeof action !== "string")
    return json({ error: "Action required." }, 400);
  const origin =
    process.env.LIGIS_PASSKEY_ORIGIN ??
    `https://${process.env.LIGIS_PASSKEY_RP_ID ?? "ligis.vercel.app"}`;
  if (req.headers.get("origin") !== origin)
    return json({ error: "Wrong serving origin." }, 403);

  if (!action.startsWith("fixture")) {
    if (action === "identity") {
      try {
        await authenticatePasskeyUser(req.headers.get("authorization"));
        return json({
          authenticated: true,
          admitted: false,
          writeReady: false,
        });
      } catch {
        return json(
          {
            error:
              "Valid Privy authentication required. Authentication does not grant issuer authority.",
          },
          401,
        );
      }
    }
    if (
      !["prepareIssue", "prepareRevoke", "issue", "revoke", "status"].includes(
        action,
      )
    ) {
      return json({ error: "Unknown action." }, 400);
    }
    return json(
      {
        error:
          "Live issuer/sponsorship unavailable. Read-only until authorized cutover and provider policy verification. No steward fallback.",
        state: "unavailable",
      },
      503,
    );
  }
  if (!fixtureEnabled())
    return json({ error: "Local fixture is disabled." }, 404);
  const token =
    req.headers.get("authorization")?.replace(/^Fixture /, "") ?? null;
  try {
    switch (action) {
      case "fixtureLogin":
        return json(fixtureLogin());
      case "fixtureAdmit":
        return json(
          fixtureAdmit(token, {
            keyId: hex(body.keyId, 32),
            qx: uint(body.qx),
            qy: uint(body.qy),
          }),
        );
      case "fixturePrepare":
        if (body.operation !== "issue" && body.operation !== "revoke")
          return json({ error: "Invalid operation." }, 400);
        return json(fixturePrepare(token, body.operation));
      case "fixtureSubmit": {
        if (typeof body.operationId !== "string")
          return json({ error: "Operation ID required." }, 400);
        if (
          Object.keys(body).some(
            (key) =>
              ![
                "action",
                "operationId",
                "authenticatorData",
                "clientDataJSON",
                "r",
                "s",
                "scenario",
              ].includes(key),
          )
        ) {
          return json(
            {
              error:
                "Caller-selected calldata, destination, chain and value are forbidden.",
            },
            400,
          );
        }
        const scenario = body.scenario ?? "confirmed";
        if (
          ![
            "confirmed",
            "pending",
            "reverted",
            "read-failure",
            "outage",
          ].includes(String(scenario))
        )
          return json({ error: "Invalid fixture scenario." }, 400);
        return json(
          await fixtureSubmit(
            token,
            body.operationId,
            {
              authenticatorData: hex(body.authenticatorData),
              clientDataJSON: hex(body.clientDataJSON),
              r: uint(body.r),
              s: uint(body.s),
            },
            origin,
            String(scenario),
          ),
        );
      }
      default:
        return json({ error: "Unknown fixture action." }, 400);
    }
  } catch (error) {
    // Only controlled fixture errors are exposed; never echo provider/RPC requests.
    const message = error instanceof Error ? error.message : "";
    const safe =
      /^(Fixture |Sponsor |Duplicate |Operator |Unknown, |Stale issuer |No active |Authenticated )/.test(
        message,
      );
    return json(
      {
        error: safe ? message : "Invalid or unauthorized fixture request.",
        fixture: true,
      },
      400,
    );
  }
}
