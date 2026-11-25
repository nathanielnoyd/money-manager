import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { type NotifySettings, sendNtfy } from "@mm/core";

/**
 * Guard for outbound requests to user-configured URLs (SSRF). By default only https and
 * public addresses are allowed, so a household owner can't make the server probe internal
 * services (the database host, cloud metadata endpoints, the LAN). Self-hosters who run
 * ntfy on their LAN or tailnet opt in with NTFY_ALLOW_PRIVATE=1.
 */

function isPrivateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number) as [number, number, number];
  return (
    a === 0 || // "this network": 0.0.0.0 reaches localhost on Linux
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT incl. Tailscale
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expand any valid IPv6 text form (compressed, embedded dotted quad) to 8 numbers. */
function ipv6Hextets(ip: string): number[] {
  let s = ip.toLowerCase().split("%")[0] as string;
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const [a, b, c, d] = dotted.split(".").map(Number) as [number, number, number, number];
    s = `${s.slice(0, -dotted.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((h) => Number.parseInt(h, 16));
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateV4(ip);
  if (isIP(ip) !== 6) return true; // not an address we understand: refuse
  const h = ipv6Hextets(ip);
  if (h.length !== 8 || h.some((x) => Number.isNaN(x))) return true;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const zero = (...xs: number[]) => xs.every((x) => x === 0);
  // Forms that embed an IPv4 address: judge the IPv4 address. URL parsing rewrites
  // [::ffff:127.0.0.1] as [::ffff:7f00:1], so these must be decoded, not string-matched.
  if (zero(h0, h1, h2, h3, h4) && (h5 === 0xffff || h5 === 0)) return isPrivateV4(v4From(h6, h7)); // mapped, compatible, ::, ::1
  if (h0 === 0x64 && h1 === 0xff9b)
    return zero(h2, h3, h4, h5) ? isPrivateV4(v4From(h6, h7)) : true; // NAT64
  if (h0 === 0x2002) return isPrivateV4(v4From(h1, h2)); // 6to4
  return (
    (h0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (h0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (h0 & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (h0 & 0xff00) === 0xff00 // multicast
  );
}

type Pinned = { address: string; family: number };

/**
 * Validate a user-configured URL. `addresses` are the addresses the host resolved to when it
 * was checked; connect to those, not to whatever the name resolves to a moment later.
 * It is null when private addresses are allowed, since nothing was checked.
 */
async function resolveOutbound(
  raw: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<{ problem: string } | { problem: null; addresses: Pinned[] | null }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { problem: "That isn't a valid URL." };
  }
  const allowPrivate = opts.allowPrivate ?? process.env.NTFY_ALLOW_PRIVATE === "1";
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    return {
      problem: "Use an https:// URL (set NTFY_ALLOW_PRIVATE=1 to allow http on your own network).",
    };
  }
  if (url.username || url.password)
    return { problem: "Put credentials in the access token field, not the URL." };
  if (allowPrivate) return { problem: null, addresses: null };
  let addresses: Pinned[];
  try {
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    addresses = isIP(literal)
      ? [{ address: literal, family: isIP(literal) }]
      : await lookup(url.hostname, { all: true });
  } catch {
    return { problem: "That host can't be resolved." };
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivate(a.address))) {
    return {
      problem:
        "That address is on a private network. Set NTFY_ALLOW_PRIVATE=1 if you self-host ntfy on your LAN or tailnet.",
    };
  }
  return { problem: null, addresses };
}

export async function checkOutboundUrl(
  raw: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<string | null> {
  return (await resolveOutbound(raw, opts)).problem;
}

const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * A minimal fetch that connects only to the given addresses, whatever DNS says by then. This
 * closes the gap between checking a host and connecting to it (DNS rebinding): a name that
 * resolved to a public address for the check can't resolve to an internal one for the request.
 * TLS still verifies the certificate against the hostname. Redirects are refused.
 */
function pinnedFetch(pinned: Pinned[]): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const req = (url.protocol === "http:" ? httpRequest : httpsRequest)(
        url,
        {
          method: init?.method ?? "GET",
          headers: Object.fromEntries(new Headers(init?.headers)),
          signal: init?.signal ?? undefined,
          lookup: (_host, options, cb) => {
            const first = pinned[0] as Pinned;
            if (options.all) cb(null, pinned);
            else cb(null, first.address, first.family);
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.destroy();
            reject(new TypeError("redirect refused"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size <= MAX_RESPONSE_BYTES) chunks.push(c);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve(
              new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
                status,
              }),
            ),
          );
        },
      );
      req.on("error", reject);
      req.end(typeof init?.body === "string" ? init.body : undefined);
    });
}

/** sendNtfy with the outbound-URL guard applied first, connecting to the addresses it checked. */
export async function safeSendNtfy(
  s: Pick<NotifySettings, "ntfyUrl" | "ntfyToken">,
  msg: { title: string; body: string; priority: "default" | "high" },
  doFetch?: typeof fetch,
): Promise<void> {
  if (!s.ntfyUrl) throw new Error("No ntfy URL configured");
  const checked = await resolveOutbound(s.ntfyUrl);
  if (checked.problem !== null) throw new Error(`ntfy URL rejected: ${checked.problem}`);
  await sendNtfy(s, msg, doFetch ?? (checked.addresses ? pinnedFetch(checked.addresses) : fetch));
}

export const __test = { isPrivate, pinnedFetch };
