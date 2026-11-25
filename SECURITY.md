# Security policy

Money Manager handles people's complete financial data. We take reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") with:

- a description and impact,
- steps to reproduce or a proof of concept,
- the affected version or commit.

We aim to acknowledge reports within 3 days and to ship a fix or mitigation for high-severity issues within 14 days. We'll credit you in the release notes unless you'd rather we didn't.

## Scope

In scope: this repository's code, Dockerfiles, default compose configuration and documentation that could lead to an insecure deployment.

Out of scope: vulnerabilities in third-party services (Tailscale, Cloudflare, aggregators), and self-hosted instances deliberately run against the guidance in `docs/self-hosting.md`.

## Supported versions

| Version                                    | Security fixes                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Latest 0.x minor release (currently 0.1.x) | Yes, as patch releases                                                 |
| Older 0.x releases                         | No: upgrade to the latest (see [docs/upgrading.md](docs/upgrading.md)) |
| `main`                                     | Yes (fixes land here first)                                            |

Security fixes are announced in the GitHub release notes and [CHANGELOG.md](CHANGELOG.md). Release images are signed; verify them as described in [docs/upgrading.md](docs/upgrading.md#verify-what-youre-running).

## Security model

See [docs/security.md](docs/security.md) for the threat model, the controls and known gaps.
