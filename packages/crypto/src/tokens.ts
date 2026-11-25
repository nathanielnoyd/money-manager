import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 256-bit random token, base64url. Used for sessions, invites, challenge ids. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

// Crockford-style alphabet without look-alikes (no 0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Single-use recovery codes like `7KQM-X2PA-9TWE` (~59 bits each). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]);
    return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
  });
}

/** Normalise user input (case, spaces, dashes) before hashing a recovery code. */
export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, "");

export const hashRecoveryCode = (code: string) => sha256Hex(normalizeRecoveryCode(code));
