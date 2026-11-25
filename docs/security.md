# Security model

Money Manager stores complete financial histories. This document lists the threats it is designed against and the controls for each. To report a gap, see [SECURITY.md](../SECURITY.md).

## Threats considered

1. **Internet attackers** scanning for exposed services
2. **A stolen or lost device** with a signed-in browser
3. **A compromised dependency** (supply-chain attack)
4. **A leaked database dump or backup**
5. **A household member** seeing another household's data on a shared instance
6. **Self-hoster misconfiguration**

## Layers

### Network: nothing exposed

- No container publishes a host port. The only way in is the `tailscale` or `cloudflared` container, which both make outbound-only connections.
- Postgres sits on a Docker network marked `internal: true`, so it has no route to the internet.
- Bank-data providers are called only by the worker, the only service that can decrypt bank tokens. The web container shares the `edge` network with the access container, and that network does have outbound access: the web tier uses it to fetch Cloudflare Access signing keys, create Plaid Link tokens, and send ntfy test messages. It never holds a usable bank credential.
- Server-side requests to user-supplied URLs (ntfy topics) go through an SSRF guard: https only, no embedded credentials, and the hostname must resolve to a public address. Loopback, private, link-local, CGNAT (including Tailscale's 100.64.0.0/10), multicast and IPv6 unique-local ranges are refused. This applies both when the URL is saved and on every send.
- The app checks the access layer again itself (Cloudflare Access JWT verification, or an optional Tailscale identity allow-list), so a misrouted request is still refused.

### Authentication: passkeys only

- WebAuthn passkeys with **user verification required**; no passwords exist.
- Break-glass: 10 single-use recovery codes (about 59 bits each, stored as SHA-256), plus optional TOTP. If TOTP is enabled, a recovery-code login requires it too. Each TOTP time-step is accepted once, so a code can't be replayed.
- **A recovery-code sign-in is deliberately weaker than a passkey sign-in.** It never counts as a recent passkey check, so it can't manage members, banks or security settings. For 15 minutes it can do exactly one sensitive thing: enroll a new passkey. Sign in with that passkey to get full access back.
- First-run setup needs a one-time token printed in the server logs. It is serialised with an advisory lock and permanently disabled once an owner exists. Setup and invite tokens are stored only as SHA-256 hashes, including in the short-lived state kept between the two WebAuthn steps.
- WebAuthn challenges are stored server-side and single-use; the browser holds only an opaque id.
- Rate limits on setup, login and recovery endpoints.

### Sessions

- 256-bit random token in an `HttpOnly; Secure; SameSite=Strict` cookie (`__Host-` prefixed over HTTPS). The database stores only its SHA-256 hash.
- 12-hour idle timeout and 30-day absolute lifetime, rotated on every sign-in. Users can sign out other devices.
- Sensitive actions (adding or removing passkeys, TOTP changes, new recovery codes) require a passkey check within the last 15 minutes. The "you can't remove your last passkey" check runs under a row lock, so two concurrent deletes can't both pass it.
- Rate limits and audit entries use the client IP from `CF-Connecting-IP` in Cloudflare mode, otherwise the address appended by the nearest proxy (the last `X-Forwarded-For` hop), so a client can't pick its own IP by sending headers.
- JSON endpoints reject requests whose `Origin` isn't the app's own (CSRF).

### Authorization: row-level security

- The app connects as `mm_app`: not a superuser, `NOBYPASSRLS`, no `CREATE` on the database.
- Every household-scoped table has an RLS policy that matches `household_id` against a per-transaction setting. If the setting is missing, it fails closed and returns zero rows.
- Two tables carry a `household_id` without a policy: `household_members` and `sessions`. Like `users` and `passkeys`, they are read while signing in, before any household is known, so a policy keyed on the household setting would lock everyone out. Every query on them filters by user or household by hand. A test compares the list of protected tables with the database's policies, so a new table with a `household_id` and no policy fails CI.
- The worker discovers due connections through one narrow `SECURITY DEFINER` function that returns only IDs.
- Integration tests prove cross-household reads, inserts and updates are blocked (`packages/db/src/rls.test.ts`).
- Foreign keys can't be checked by RLS policies alone (a row may legally point at an ID it can't see). Server actions therefore confirm that every category, category group and account ID they're given is visible in the caller's household before writing it.

### Roles within a household

- `owner`, `member` and `viewer`, enforced server-side on every mutation (not just hidden in the UI). Viewers get a read-only experience, and any write they attempt is refused.
- Owner-only actions also require a passkey check within the last 15 minutes: managing members and invites, linking or disconnecting banks, deleting accounts, and changing where notifications go or what AI features may see. When the notification destination changes, the previous destination gets a warning.
- Role changes and member removals lock the household's membership rows and re-check the actor is still an owner, so a household can't race down to zero owners.
- Sessions are joined to the household membership on every request, so removing someone signs them out immediately.
- Invites are 256-bit single-use tokens, stored only as hashes and valid for 7 days. Acceptance looks up exactly one invite by hash through a narrow `SECURITY DEFINER` function, and an advisory lock prevents double acceptance.

### Secrets and encryption

- **Bank tokens** are sealed with libsodium sealed boxes (X25519 + XSalsa20-Poly1305). The web tier has only the public key, so it can store a token but never read one back. The worker holds the private key and decrypts in memory only during a sync. Key IDs support rotation (`reseal`). Linking works the same way for every provider: the web tier seals only the _one-time_ credential (a SimpleFIN setup token or a Plaid public token), and the worker exchanges it for long-lived access.
- **Teller** is the exception to "the browser never sees a long-lived token": Teller Connect returns the access token to the page, which seals it for the worker in the same request. The Teller client certificate (mTLS) is mounted only into the worker.
- **Notifications**: the ntfy topic URL is stored in the database. The access token is too, but it is never sent back to the browser. Messages can omit all amounts.
- **Plaid client secret** (optional) lives in the web and worker environment. The web tier needs it to create Link tokens, but on its own it can't read anyone's data without an access token, which only the worker holds.
- **TOTP seeds** are encrypted with libsodium secretbox under a key only the web tier has.
- Full account numbers are never stored, only the last 2–4 digits.
- Generated secrets (database passwords, sealing keys, the session/TOTP key) are Docker secrets (files), never baked into images or written to the database. Optional third-party keys (`PLAID_SECRET`, `ANTHROPIC_API_KEY`) are read from `.env` for convenience, which means they're visible in `docker inspect`. Every secret can instead be supplied as a file with the `_FILE` suffix; see [self-hosting.md → Keep API keys out of the environment](self-hosting.md#keep-api-keys-out-of-the-environment).

### Web hardening

- A strict Content-Security-Policy with a per-request nonce and `strict-dynamic`. No third-party fonts or analytics; fonts are self-hosted.
- **One exception to "no third-party scripts":** if the operator configures Plaid or Teller, that provider's bank-link script (`cdn.plaid.com`, `cdn.teller.io`) is loaded when someone clicks **Connect** under Settings → Connections. It is not loaded on any other page view, and not at all for SimpleFIN or file imports. While it is loaded it runs in the app's origin, so a compromised provider CDN could act as the signed-in owner in that tab. `connect-src 'self'`, `img-src` and `form-action 'self'` limit where it could send data, but do not make it harmless. Use SimpleFIN if you don't want to extend that trust.
- `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP, a restrictive Permissions-Policy, and HSTS.
- Responses are `Cache-Control: no-store`.
- Every page and API route needs a session except sign-in, setup, invite acceptance, demo entry and the health check (auth API routes that act on an account check the session themselves). The gate makes no exception for prefetch or any other request header.
- Transaction rules match with plain-text operators (contains, contains any of, equals, starts with). There's deliberately no regular-expression operator: one bad pattern could stall every import (ReDoS).

### Containers

- The web and worker containers run as non-root (`uid 1000`) with a read-only root filesystem, `cap_drop: ALL` and `no-new-privileges`. Writable paths are tmpfs only.
- The optional backup container has the same restrictions except that it runs as root, with every capability dropped, so that it can write to backup volumes and repositories created by earlier versions. It holds the database admin password, and it shares the worker's outbound network so that it can reach your backup destination.
- Health checks: liveness for the web container, and a heartbeat file for the worker.

### AI (optional)

- Off by default at two levels: the server needs `ANTHROPIC_API_KEY`, and each household's owner must opt in after reading what's shared. Always off in demo mode.
- **Least data:** categorization sends a description and an amount per transaction. Q&A gives Claude read-only tools that return aggregates or at most 25 rows, computed under the household's RLS scope, with each call in its own short transaction. Account numbers, credentials, tokens and other households' data are never reachable.
- Model output is rendered as React text by a small markdown subset renderer (no HTML injection). AI never overwrites a category a person set, and its suggestions are marked for review.
- Refusals are handled, and server-side refusal fallbacks are enabled on models that support them. Interactive calls are rate-limited per household, and token usage is logged per feature. Question text isn't persisted.

### Agent access (MCP)

- `/api/mcp` accepts only a bearer **agent token** (`mm_pat_…`, 256 bits). The session cookie is ignored, so there's no CSRF surface, and requests carrying a foreign `Origin` are refused. The network access gate still applies.
- Only the SHA-256 hash is stored. Tokens live in an RLS-protected table. The pre-scope lookup is a SECURITY DEFINER function, `find_api_token(hash)`, that returns only the row matching the hash.
- A token acts as the person who created it. On every request its role is the lower of its `max_role` and that person's **current** membership, and its scopes (`read`, `transactions:write`, `planning:write`, `rewards:write`, `rewards:catalog`) narrow it further. Viewer tokens are read-only. Leaving the household disables the token at once.
- Creating a token needs a passkey step-up. Tokens expire (7–365 days) and can be revoked instantly. Owners see every member's tokens. Creation, revocation and every write made through a token are recorded in the audit log.
- Tools are generated from the same operations the UI uses, run under household RLS, and never return account numbers or masks. The MCP surface excludes bank linking, credentials, members, security and AI settings, export and account deletion.
- Card catalog edits (by agents, or by the optional monthly refresher in the worker) change only this household's copy, are validated against the catalog schema and bounds, keep their source, and can be undone. The owner can require approval, and approval is never available to an agent token. The refresher sends Claude only public catalog entries and can read only each entry's own source sites.
- Bank descriptions are attacker-controlled text, so the server instructs agents to treat all text fields as data. Writes are capped per call, requests are limited to 120 per minute per token, and an address is locked out after 20 failed token attempts in 15 minutes. The MCP server is off in demo mode.

### Supply chain

- Lockfile-frozen installs. Only allow-listed packages may run install scripts (`allowBuilds` in `pnpm-workspace.yaml`).
- CI runs Gitleaks, CodeQL (security-extended), `pnpm audit` and Trivy. GitHub Actions are pinned to commit SHAs and base images to digests, including the third-party Tailscale and cloudflared images; Renovate keeps them current and waits 7 days before adopting a new release.
- Release images are multi-arch, signed with Sigstore cosign (keyless, tied to this repository's release workflow), and carry SBOMs and SLSA build provenance. See [upgrading.md → Verify what you're running](upgrading.md#verify-what-youre-running).

### Logging and audit

- An `audit_log` table records setup, logins, failures, security-setting changes, agent token creation and revocation, and every write made with an agent token (`agent.write`). The app role can insert into it but not update or delete it.
- Worker logs redact tokens, secrets, amounts and balances.

## Known gaps

- **No independent audit.** The authentication, crypto and row-level security code has not been reviewed by a third party.
- Rate limits are kept in memory per process. That's fine for the single web container this project ships, but they reset on restart.
