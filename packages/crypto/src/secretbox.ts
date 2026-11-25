import { sodium } from "./sodium";

/**
 * Symmetric authenticated encryption (XSalsa20-Poly1305) for small secrets the web
 * tier must read back itself, e.g. TOTP seeds. Key: 32 random bytes, base64url.
 * Format: `s1.<base64url(nonce || ciphertext)>`
 */

export async function generateSecretKey(): Promise<string> {
  const s = await sodium();
  return s.to_base64(s.crypto_secretbox_keygen(), s.base64_variants.URLSAFE_NO_PADDING);
}

async function key(keyB64: string) {
  const s = await sodium();
  const k = s.from_base64(keyB64, s.base64_variants.URLSAFE_NO_PADDING);
  if (k.length !== s.crypto_secretbox_KEYBYTES) throw new Error("secretbox: bad key length");
  return { s, k };
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const { s, k } = await key(keyB64);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const ct = s.crypto_secretbox_easy(s.from_string(plaintext), nonce, k);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return `s1.${s.to_base64(out, s.base64_variants.URLSAFE_NO_PADDING)}`;
}

export async function decryptSecret(boxed: string, keyB64: string): Promise<string> {
  const { s, k } = await key(keyB64);
  const [v, body] = boxed.split(".");
  if (v !== "s1" || !body) throw new Error("secretbox: unrecognised format");
  const raw = s.from_base64(body, s.base64_variants.URLSAFE_NO_PADDING);
  const nonce = raw.slice(0, s.crypto_secretbox_NONCEBYTES);
  const ct = raw.slice(s.crypto_secretbox_NONCEBYTES);
  return s.to_string(s.crypto_secretbox_open_easy(ct, nonce, k));
}
