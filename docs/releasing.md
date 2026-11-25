# Releasing (maintainers)

Releases are cut from `main` by pushing a version tag. Everything after that is automated in [.github/workflows/release.yml](../.github/workflows/release.yml).

## Steps

1. Make sure `main` is green in CI.
2. Move the `## [Unreleased]` entries in [CHANGELOG.md](../CHANGELOG.md) under a new `## [x.y.z] - YYYY-MM-DD` heading (for 0.1.0, replace "Unreleased" in its heading with the date). Add an **Upgrade notes** subsection if anything needs operator action, and update the compare links at the bottom.
3. Set `"version"` to `x.y.z` in the root `package.json` and in every `apps/*/package.json` and `packages/*/package.json`, then commit with `chore(release): vx.y.z`. The release workflow refuses a tag that doesn't match the root version.
4. Tag and push:

   ```bash
   git tag -s vx.y.z -m "vx.y.z"
   git push origin vx.y.z
   ```

   Use `vx.y.z-rc.1` style tags for pre-releases; they're published as GitHub pre-releases.

## What the workflow does

1. Runs the full CI suite (lint, typecheck, unit + integration tests, E2E, image builds).
2. Builds `web`, `worker` and `backup` for linux/amd64 and linux/arm64 and pushes them to `ghcr.io/<owner>/money-manager-<target>` with tags `x.y.z`, `x.y` and `sha-<commit>`.
3. Attaches BuildKit SBOMs and max-mode provenance to each image.
4. Signs each image digest with **cosign keyless** signing (Sigstore, using the workflow's OIDC identity: no long-lived signing keys to manage or leak).
5. Publishes GitHub build-provenance attestations for each image.
6. Creates the GitHub release with notes from the changelog section, verification instructions, and an SPDX SBOM of the source tree.

## One-time repository setup

- **Settings → Actions → General → Workflow permissions:** "Read repository contents" is enough; jobs request the extra scopes they need (`packages: write`, `id-token: write`, `attestations: write`, `contents: write`).
- After the first release, make the three GHCR packages **public** (Packages → package settings) so self-hosters can pull without logging in.
- **Settings → Code security:** enable private vulnerability reporting, Dependabot alerts, secret scanning and push protection.
- **Code scanning:** once it's available (free on public repositories), enable it under **Settings → Code security** and set the Actions variable `CODEQL_UPLOAD=true` (**Settings → Secrets and variables → Actions → Variables**). The CodeQL job then uploads its results as alerts. Until then, it keeps them as a `codeql-sarif` artifact and fails on any finding.
- **Branch protection on `main`:** require the CI checks (including **Sign-off (DCO)** and, once public, **Dependency review**) and one review, and block force-pushes. `.github/CODEOWNERS` requests a maintainer's review automatically; only turn on "Require review from Code Owners" once there is more than one maintainer, since nobody can approve their own pull request.
- **Renovate:** install the Renovate GitHub App on the repository. `renovate.json` already pins Actions and image digests and signs off its commits.
