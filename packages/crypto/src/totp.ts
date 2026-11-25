import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 TOTP (HMAC-SHA1, 30s, 6 digits) — the profile every authenticator app supports. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let clean = s.toUpperCase().replace(/\s/g, "");
  let end = clean.length;
  while (end > 0 && clean[end - 1] === "=") end--; // strip padding
  clean = clean.slice(0, end);
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("base32: invalid character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = (h[h.length - 1] as number) & 0xf;
  const bin = h.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (nowMs = Date.now(), period = 30) => Math.floor(nowMs / 1000 / period);

/**
 * Verify a code within ±`window` steps. Returns the matched step (store it and pass
 * as `lastUsedStep` next time to prevent replay) or null.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { nowMs?: number; window?: number; lastUsedStep?: number | null } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = totpStep(opts.nowMs);
  const window = opts.window ?? 1;
  for (let step = now - window; step <= now + window; step++) {
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function totpUri(secretB32: string, account: string, issuer = "Money Manager"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params}`;
}
