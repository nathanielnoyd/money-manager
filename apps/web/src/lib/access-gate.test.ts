import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccessGate, isGateExempt, isPublicPath } from "./access-gate";

const headers = (h: Record<string, string> = {}) => new Headers(h);

describe("access gate: tailscale", () => {
  it("lets everything through when no allow-list is set (the tailnet is the gate)", async () => {
    const gate = createAccessGate({ mode: "tailscale", tailscaleAllowed: [""] });
    expect(await gate.passes(headers())).toBe(true);
  });

  it("admits only allowed tailnet logins, ignoring case and spaces", async () => {
    const gate = createAccessGate({
      mode: "tailscale",
      tailscaleAllowed: [" Alex@Example.com", "sam@example.com "],
    });
    expect(await gate.passes(headers({ "tailscale-user-login": "alex@example.com" }))).toBe(true);
    expect(await gate.passes(headers({ "tailscale-user-login": "SAM@example.com" }))).toBe(true);
    expect(await gate.passes(headers({ "tailscale-user-login": "eve@example.com" }))).toBe(false);
    expect(await gate.passes(headers({ "tailscale-user-login": "" }))).toBe(false);
    expect(await gate.passes(headers())).toBe(false);
  });

  it("ignores a Cloudflare token in tailscale mode", async () => {
    const gate = createAccessGate({ mode: "tailscale", tailscaleAllowed: ["alex@example.com"] });
    expect(await gate.passes(headers({ "cf-access-jwt-assertion": "x" }))).toBe(false);
  });
});

describe("access gate: cloudflare", () => {
  const team = "myteam.cloudflareaccess.com";
  const aud = "aud-tag-123";
  let sign: (claims: { iss?: string; aud?: string; exp?: string | number }) => Promise<string>;
  let otherSign: () => Promise<string>;
  let keys: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const other = await generateKeyPair("RS256");
    keys = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }],
    });
    sign = (c) =>
      new SignJWT({ email: "alex@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(c.iss ?? `https://${team}`)
        .setAudience(c.aud ?? aud)
        .setIssuedAt()
        .setExpirationTime(c.exp ?? "5m")
        .sign(privateKey);
    otherSign = () =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(`https://${team}`)
        .setAudience(aud)
        .setExpirationTime("5m")
        .sign(other.privateKey);
  });

  const gate = () =>
    createAccessGate({
      mode: "cloudflare",
      tailscaleAllowed: [],
      cfTeamDomain: team,
      cfAudience: aud,
      cfKeys: keys,
    });
  const withToken = async (t: string) => gate().passes(headers({ "cf-access-jwt-assertion": t }));

  it("accepts a valid Access token", async () => {
    expect(await withToken(await sign({}))).toBe(true);
  });

  it("refuses a missing, malformed, expired, mis-addressed or forged token", async () => {
    expect(await gate().passes(headers())).toBe(false);
    expect(await withToken("not-a-jwt")).toBe(false);
    expect(await withToken(await sign({ exp: Math.floor(Date.now() / 1000) - 60 }))).toBe(false);
    expect(await withToken(await sign({ aud: "another-app" }))).toBe(false);
    expect(await withToken(await sign({ iss: "https://evil.cloudflareaccess.com" }))).toBe(false);
    expect(await withToken(await otherSign())).toBe(false);
  });

  it("fails closed when Cloudflare isn't fully configured", async () => {
    const t = await sign({});
    const h = headers({ "cf-access-jwt-assertion": t });
    expect(
      await createAccessGate({
        mode: "cloudflare",
        tailscaleAllowed: [],
        cfKeys: keys,
        cfTeamDomain: team,
      }).passes(h),
    ).toBe(false);
    expect(
      await createAccessGate({
        mode: "cloudflare",
        tailscaleAllowed: [],
        cfKeys: keys,
        cfAudience: aud,
      }).passes(h),
    ).toBe(false);
  });

  it("doesn't accept a Tailscale header instead", async () => {
    expect(await gate().passes(headers({ "tailscale-user-login": "alex@example.com" }))).toBe(
      false,
    );
  });
});

describe("paths", () => {
  it("knows which paths need no session", () => {
    for (const p of [
      "/login",
      "/login/recovery",
      "/setup",
      "/invite/abc",
      "/api/auth/login/options",
      "/api/health",
      "/api/mcp",
    ])
      expect(isPublicPath(p), p).toBe(true);
    for (const p of [
      "/",
      "/transactions",
      "/login-help",
      "/setupx",
      "/invite",
      "/api/mcpx",
      "/api/export",
      "/settings/export",
    ])
      expect(isPublicPath(p), p).toBe(false);
  });

  it("exempts only the health check from the access gate", () => {
    expect(isGateExempt("/api/health")).toBe(true);
    for (const p of ["/api/healthz", "/api/mcp", "/login", "/api/webhooks/plaid"])
      expect(isGateExempt(p), p).toBe(false);
  });
});
