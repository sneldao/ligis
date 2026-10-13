import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { exactKeys, object } from "./schema";

export type CallerGrant = { tenant: string; tokenSha256: string; optIn: true };
export function parseCallerGrants(
  value: string | undefined,
): CallerGrant[] | null {
  try {
    if (!value || value.length > 10_000) return null;
    const raw: unknown = JSON.parse(value);
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) return null;
    if (
      !raw.every(
        (item) =>
          object(item) &&
          exactKeys(item, ["tenant", "tokenSha256", "optIn"]) &&
          typeof item.tenant === "string" &&
          /^[a-z0-9_-]{1,64}$/i.test(item.tenant) &&
          typeof item.tokenSha256 === "string" &&
          /^[a-f0-9]{64}$/.test(item.tokenSha256) &&
          item.optIn === true,
      )
    )
      return null;
    if (new Set(raw.map((item) => item.tokenSha256)).size !== raw.length)
      return null;
    return raw as CallerGrant[];
  } catch {
    return null;
  }
}
export function authenticateOutcomeCaller(
  headers: Headers,
  grants: CallerGrant[],
): CallerGrant | null {
  const authorization = headers.get("authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization))
    return null;
  const digest = createHash("sha256").update(authorization.slice(7)).digest();
  // Do not log/return auth values. Equal-sized hash comparison only.
  let match: CallerGrant | null = null;
  for (const grant of grants) {
    if (timingSafeEqual(digest, Buffer.from(grant.tokenSha256, "hex")))
      match = grant;
  }
  return match?.optIn === true ? match : null;
}
