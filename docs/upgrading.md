# Upgrading

Database migrations run automatically every time the stack starts (the one-shot `migrate` service), and they are written to be additive. Upgrades are usually: back up, pull, restart.

## Before every upgrade

1. **Read the release notes** in [CHANGELOG.md](../CHANGELOG.md), especially any **Upgrade notes**.
2. **Back up the database:**

   ```bash
   docker compose run --rm backup now      # with the backup profile
   # or, without it:
   docker compose exec -T db pg_dump -U mm_admin -Fc money_manager > before-upgrade.dump
   ```
3. Make sure your `secrets/` folder is backed up too (see [self-hosting.md](self-hosting.md#2-generate-secrets)).

## Using published images (recommended)

Releases are published to GHCR as signed, multi-arch images. In `.env`:

```ini
MM_IMAGE_PREFIX=ghcr.io/nathanielnoyd/money-manager
MM_VERSION=0.1.0
```

Then:

```bash
docker compose pull
docker compose up -d
docker compose logs migrate     # should end with "✓ migrations applied"
```

### Verify what you're running

Each image is signed with Sigstore (keyless, from this repository's release workflow) and carries an SBOM and build provenance:

```bash
cosign verify ghcr.io/nathanielnoyd/money-manager-web:0.1.0 \
  --certificate-identity-regexp '^https://github.com/nathanielnoyd/money-manager/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify oci://ghcr.io/nathanielnoyd/money-manager-web:0.1.0 --owner nathanielnoyd
```

Pin by digest for fully reproducible deployments: `docker compose images` shows the digests you're running.

## Building from source

```bash
git fetch --tags && git checkout v0.1.0
docker compose up -d --build
```

## Rolling back

Migrations aren't automatically reversible. To roll back:

1. `docker compose stop web worker`
2. Restore the backup you took before upgrading (see [self-hosting.md → Backups](self-hosting.md#8-backups)). The restore keeps your current database as `money_manager_before_restore_<timestamp>`.
3. Set `MM_VERSION` back to the previous version (or check out the previous tag), then `docker compose up -d`.

## Version policy

- Before 1.0: minor versions (0.x.0) may change configuration or behavior; this is always documented under **Upgrade notes**. Patch versions (0.1.x) are fixes only.
- Security fixes are released as patch versions for the latest minor. See [SECURITY.md](../SECURITY.md).
