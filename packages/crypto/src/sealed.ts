import { createHash } from "node:crypto";
import { sodium } from "./sodium";

/**
 * Asymmetric "sealed box" encryption for aggregator credentials.
 *
 * The web tier holds only the PUBLIC key: it can seal a token it receives from a
 * bank-link flow, but can never open one. Only the worker holds the private key.
 *
 * Format: `v1.<kid>.<base64url(ciphertext)>` where kid identifies the key pair, so
 * keys can be rotated by adding a new pair and re-sealing (see `reseal`).
 */

export interface KeyPair {
  kid: string;
  publicKey: string; // base64url
  privateKey: string; // base64url
}

export const keyId = (publicKeyB64: string) =>
  createHash("sha256").update(publicKeyB64).digest("base64url").slice(0, 10);

export async function generateKeyPair(): Promise<KeyPair> {
  const s = await sodium();
  const kp = s.crypto_box_keypair();
  const publicKey = s.to_base64(kp.publicKey, s.base64_variants.URLSAFE_NO_PADDING);
  return {
    kid: keyId(publicKey),
    publicKey,
    privateKey: s.to_base64(kp.privateKey, s.base64_variants.URLSAFE_NO_PADDING),
  };
}

export async function seal(plaintext: string, publicKeyB64: string): Promise<string> {
  const s = await sodium();
  const pk = s.from_base64(publicKeyB64, s.base64_variants.URLSAFE_NO_PADDING);
  if (pk.length !== s.crypto_box_PUBLICKEYBYTES) throw new Error("seal: bad public key");
  const ct = s.crypto_box_seal(s.from_string(plaintext), pk);
  return `v1.${keyId(publicKeyB64)}.${s.to_base64(ct, s.base64_variants.URLSAFE_NO_PADDING)}`;
}

/** Open a sealed value with any key pair in the keyring (matched by kid). */
export async function open(sealed: string, keyring: readonly KeyPair[]): Promise<string> {
  const s = await sodium();
  const [version, kid, body] = sealed.split(".");
  if (version !== "v1" || !kid || !body) throw new Error("open: unrecognised format");
  const kp = keyring.find((k) => k.kid === kid);
  if (!kp) throw new Error(`open: no key for kid ${kid}`);
  const b64 = s.base64_variants.URLSAFE_NO_PADDING;
  const pt = s.crypto_box_seal_open(
    s.from_base64(body, b64),
    s.from_base64(kp.publicKey, b64),
    s.from_base64(kp.privateKey, b64),
  );
  return s.to_string(pt);
}

/** Re-seal under a new public key (key rotation). */
export async function reseal(
  sealed: string,
  keyring: readonly KeyPair[],
  newPublicKey: string,
): Promise<string> {
  return seal(await open(sealed, keyring), newPublicKey);
}

/** Parse the WORKER_KEYS secret: JSON array of KeyPair. */
export function parseKeyring(json: string): KeyPair[] {
  const parsed = JSON.parse(json) as KeyPair[];
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("keyring: empty");
  for (const k of parsed) {
    if (keyId(k.publicKey) !== k.kid) throw new Error("keyring: kid does not match public key");
  }
  return parsed;
}
