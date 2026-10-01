import { NextRequest } from "next/server";
import { isAddress, type Address, type Hex } from "viem";
import {
  enrollPasskey,
  isEnrolled,
  issueCredential,
  passkeyConfig,
  prepareIssue,
  prepareRevoke,
  readIsCapable,
  revokeCredential,
} from "@/lib/passkey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x[0-9a-fA-F]*$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bad(message: string) {
  return json({ error: message }, 400);
}

function addr(v: unknown): Address | null {
  return typeof v === "string" && isAddress(v) ? (v as Address) : null;
}

function hex(v: unknown, re: RegExp): Hex | null {
  return typeof v === "string" && re.test(v) ? (v as Hex) : null;
}

function capabilityOf(v: unknown): string | null {
  return typeof v === "string" && /^[a-z0-9._-]{1,64}$/i.test(v) ? v : null;
}

type Body = Record<string, unknown>;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Invalid JSON body");
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "config": {
        return json(await passkeyConfig());
      }

      case "prepareIssue": {
        const subject = addr(body.subject);
        const capability = capabilityOf(body.capability);
        if (!subject) return bad("subject must be an EVM address");
        if (!capability)
          return bad("capability must be a dotted id like demo.passkey");
        return json(await prepareIssue(subject, capability));
      }

      case "prepareRevoke": {
        const subject = addr(body.subject);
        const capHash = hex(body.capabilityHash, HEX32);
        const nonce =
          typeof body.nonce === "string" ? BigInt(body.nonce) : null;
        if (!subject || !capHash || nonce === null) {
          return bad("subject, capabilityHash, nonce required");
        }
        return json({ digest: prepareRevoke(subject, capHash, nonce) });
      }

      case "enroll": {
        const keyId = hex(body.keyId, HEX32);
        const qx = typeof body.qx === "string" ? BigInt(body.qx) : null;
        const qy = typeof body.qy === "string" ? BigInt(body.qy) : null;
        if (!keyId || qx === null || qy === null) {
          return bad("keyId, qx, qy required");
        }
        if (await isEnrolled(keyId)) {
          return json({ tx: null, alreadyEnrolled: true });
        }
        return json({ tx: await enrollPasskey(keyId, qx, qy) });
      }

      case "issue": {
        const subject = addr(body.subject);
        const capability = capabilityOf(body.capability);
        const keyId = hex(body.keyId, HEX32);
        const authenticatorData = hex(body.authenticatorData, HEX);
        const clientDataJSON = hex(body.clientDataJSON, HEX);
        if (
          !subject ||
          !capability ||
          !keyId ||
          !authenticatorData ||
          !clientDataJSON
        ) {
          return bad(
            "subject, capability, keyId, authenticatorData, clientDataJSON required",
          );
        }
        const num = (k: string) =>
          typeof body[k] === "string" ? BigInt(body[k] as string) : null;
        const issuedAt = num("issuedAt");
        const expiresAt = num("expiresAt");
        const nonce = num("nonce");
        const r = num("r");
        const s = num("s");
        if ([issuedAt, expiresAt, nonce, r, s].some((v) => v === null)) {
          return bad("issuedAt, expiresAt, nonce, r, s required");
        }
        const out = await issueCredential({
          subject,
          capability,
          issuedAt: issuedAt!,
          expiresAt: expiresAt!,
          nonce: nonce!,
          keyId,
          authenticatorData,
          clientDataJSON,
          r: r!,
          s: s!,
        });
        return json(out);
      }

      case "revoke": {
        const subject = addr(body.subject);
        const capability = capabilityOf(body.capability);
        const keyId = hex(body.keyId, HEX32);
        const authenticatorData = hex(body.authenticatorData, HEX);
        const clientDataJSON = hex(body.clientDataJSON, HEX);
        const nonce =
          typeof body.nonce === "string" ? BigInt(body.nonce) : null;
        if (
          !subject ||
          !capability ||
          !keyId ||
          !authenticatorData ||
          !clientDataJSON ||
          nonce === null
        ) {
          return bad(
            "subject, capability, nonce, keyId, authenticatorData, clientDataJSON required",
          );
        }
        const r = typeof body.r === "string" ? BigInt(body.r) : null;
        const s = typeof body.s === "string" ? BigInt(body.s) : null;
        if (r === null || s === null) return bad("r, s required");
        return json(
          await revokeCredential({
            subject,
            capability,
            nonce,
            keyId,
            authenticatorData,
            clientDataJSON,
            r,
            s,
          }),
        );
      }

      case "status": {
        const subject = addr(body.subject);
        const capability = capabilityOf(body.capability);
        if (!subject || !capability) return bad("subject, capability required");
        return json({ capable: await readIsCapable(subject, capability) });
      }

      default:
        return bad("unknown action");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface the contract revert reason (InvalidSignature etc.) — it is the
    // difference between "ceremony wrong" and "relayer wrong" in the UI.
    return json({ error: msg.slice(0, 300) }, 500);
  }
}
