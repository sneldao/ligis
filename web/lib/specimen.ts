/**
 * Maps any subject string to the 0x-hex form AgentPortrait expects.
 *
 * EVM addresses pass through untouched so a wallet renders the same
 * specimen on /gate as it does in /field. Casper `account-hash-<hex>` and
 * raw hex keys use their hex body. Anything else is FNV-1a hashed so a
 * half-typed or malformed subject still gets a stable, valid portrait
 * instead of crashing the deck lookup on NaN bytes.
 */
export function specimenAddress(subject: string): string | null {
  const s = subject.trim().toLowerCase();
  if (!s) return null;

  const hexBody = s.replace(/^account-hash-/, "").replace(/^0x/, "");
  if (/^[0-9a-f]{40,}$/.test(hexBody)) return `0x${hexBody.slice(0, 40)}`;

  let out = "";
  let h = 0x811c9dc5;
  for (let round = 0; out.length < 40; round++) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) + round;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return `0x${out.slice(0, 40)}`;
}
