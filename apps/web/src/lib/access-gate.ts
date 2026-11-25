import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

/**
 * The network access gate: defence in depth behind Tailscale or Cloudflare Access, checked on
 * every request before the app's own sign-in. Pure apart from the JWT key lookup, so it can be
 * tested without a running proxy. proxy.ts builds it from the environment once at start-up.
 */

export type AccessMode = "none" | "tailscale" | "cloudflare";

export interface AccessGateConfig {
  mode: AccessMode;
  /** Tailnet logins allowed in tailscale mode. Empty: rely on the tailnet alone. */
  tailscaleAllowed: string[];
  /** Cloudflare Access team domain, e.g. "myteam.cloudflareaccess.com". */
  cfTeamDomain?: string;
  /** The Access application's audience tag. */
  cfAudience?: string;
  /** Signing keys for Access tokens. Defaults to the team's published key set. */
  cfKeys?: JWTVerifyGetKey;
}

export interface AccessGate {
  passes(headers: Headers): Promise<boolean>;
}

export function createAccessGate(cfg: AccessGateConfig): AccessGate {
  const allowed = new Set(cfg.tailscaleAllowed.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const keys =
    cfg.cfKeys ??
    (cfg.cfTeamDomain
      ? createRemoteJWKSet(new URL(`https://${cfg.cfTeamDomain}/cdn-cgi/access/certs`))
      : undefined);

  return {
    async passes(headers) {
      if (cfg.mode === "cloudflare") {
        const token = headers.get("cf-access-jwt-assertion");
        // Fail closed when Cloudflare isn't fully configured.
        if (!token || !keys || !cfg.cfAudience || !cfg.cfTeamDomain) return false;
        try {
          await jwtVerify(token, keys, {
            issuer: `https://${cfg.cfTeamDomain}`,
            audience: cfg.cfAudience,
          });
          return true;
        } catch {
          return false;
        }
      }
      if (cfg.mode === "tailscale" && allowed.size > 0) {
        // `tailscale serve` sets this for requests from tailnet users and strips client-supplied values.
        const login = headers.get("tailscale-user-login")?.trim().toLowerCase();
        return !!login && allowed.has(login);
      }
      return true;
    },
  };
}

// Paths that are reachable without a session. Each entry matches itself and anything below
// it ("/login" covers "/login/recovery" but not "/login-help"); an entry ending in "/" covers
// only what's below it. /api/mcp authenticates with a bearer token inside its route.
const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/invite/",
  "/api/auth/",
  "/api/demo/",
  "/api/health",
  "/api/mcp",
];
// Paths the access gate doesn't apply to: Docker's health check calls this from inside the
// container, without going through Tailscale or Cloudflare.
const GATE_EXEMPT = ["/api/health"];

const under = (pathname: string, p: string) =>
  p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`);

export const isPublicPath = (pathname: string) => PUBLIC_PATHS.some((p) => under(pathname, p));
export const isGateExempt = (pathname: string) => GATE_EXEMPT.some((p) => under(pathname, p));
