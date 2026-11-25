import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateKeyPair,
  generateRecoveryCodes,
  generateSecretKey,
  hashRecoveryCode,
  hotp,
  open,
  parseKeyring,
  reseal,
  seal,
  verifyTotp,
} from "./index";

describe("sealed boxes", () => {
  it("round-trips with the matching key and records the kid", async () => {
    const kp = await generateKeyPair();
    const sealed = await seal("access-token-123", kp.publicKey);
    expect(sealed.startsWith(`v1.${kp.kid}.`)).toBe(true);
    expect(sealed).not.toContain("access-token-123");
    expect(await open(sealed, [kp])).toBe("access-token-123");
  });

  it("cannot be opened with the wrong key", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const sealed = await seal("secret", a.publicKey);
    await expect(open(sealed, [b])).rejects.toThrow(/no key/);
    await expect(open(sealed, [{ ...b, kid: a.kid }])).rejects.toThrow();
  });

  it("supports rotation via reseal", async () => {
    const oldKp = await generateKeyPair();
    const newKp = await generateKeyPair();
    const rotated = await reseal(await seal("x", oldKp.publicKey), [oldKp], newKp.publicKey);
    expect(await open(rotated, [newKp])).toBe("x");
  });

  it("rejects a keyring whose kid does not match its public key", async () => {
    const kp = await generateKeyPair();
    expect(() => parseKeyring(JSON.stringify([{ ...kp, kid: "nope" }]))).toThrow();
    expect(parseKeyring(JSON.stringify([kp]))).toHaveLength(1);
  });
});

describe("secretbox", () => {
  it("round-trips and detects tampering", async () => {
    const key = await generateSecretKey();
    const boxed = await encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(await decryptSecret(boxed, key)).toBe("JBSWY3DPEHPK3PXP");
    const tampered = `${boxed.slice(0, -2)}${boxed.endsWith("A") ? "B" : "A"}A`;
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
  });
});

describe("TOTP (RFC 6238 SHA-1 vectors)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, code) => {
    expect(hotp(base32Decode(secret), Math.floor(t / 30))).toBe(code);
    expect(verifyTotp(secret, code, { nowMs: t * 1000, window: 0 })).toBe(Math.floor(t / 30));
  });

  it("decodes base32 with padding, spaces and lower case", () => {
    const bytes = Buffer.from("foobar");
    expect(base32Decode("MZXW6YTBOI======")).toEqual(bytes);
    expect(base32Decode("mzxw 6ytb oi")).toEqual(bytes);
    expect(base32Decode(`MZXW6YTBOI${"=".repeat(100_000)}`)).toEqual(bytes);
    expect(() => base32Decode("MZXW=6YT")).toThrow();
  });

  it("rejects replay of an already-used step", () => {
    const step = verifyTotp(secret, "287082", { nowMs: 59_000 });
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, "287082", { nowMs: 59_000, lastUsedStep: step })).toBeNull();
  });

  it("rejects malformed codes", () => {
    expect(verifyTotp(secret, "12345", { nowMs: 59_000 })).toBeNull();
    expect(verifyTotp(secret, "abcdef", { nowMs: 59_000 })).toBeNull();
  });
});

describe("recovery codes", () => {
  it("are unique, formatted, and hash independently of case/dashes", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    const c = codes[0] as string;
    expect(hashRecoveryCode(c.toLowerCase().replaceAll("-", " "))).toBe(hashRecoveryCode(c));
  });
});
