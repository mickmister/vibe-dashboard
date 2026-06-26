---
name: beads-web-plugin-refresh
description: Use when refreshing the built-in vd.beads-web plugin release in vibe-dashboard, including catalog/fixture version pins, GitHub release asset sha256 verification, orchestrator test expectations, and validation commands.
---

# Refresh built-in beads-web plugin

Use this workflow when updating `vd.beads-web` to a new GitHub release tag.

## Files to update

- `plugins/builtin.plugins.json` — production built-in plugin catalog copied into container images.
- `plugins/fixtures/beads-web.plugin.json` — single-plugin fixture for instance-config CLI tests.
- `plugins/fixtures/beads-web.plugins.json` — catalog fixture for orchestrator tests.
- Tests that hard-code the version, install paths, release URLs, or sha256 values:
  - `plugins/orchestrator/plugin-service-orchestrator.test.ts`
  - `plugins/orchestrator/plugin-runtime-apply-script.test.ts`
  - `src/lib/pluginAdminApi.test.ts` only if the expected admin API fixture version should track the built-in release.

## CLI refresh steps

Prefer the checked-in CLI when refreshing beads-web:

```sh
npm run plugin-services:refresh:beads-web -- --tag v0.11.6
```

This command updates:

- `plugins/builtin.plugins.json`
- `plugins/fixtures/beads-web.plugin.json`
- `plugins/fixtures/beads-web.plugins.json`

It downloads each configured GitHub release asset, computes SHA-256 locally, and rewrites the matching `github-release-asset` installer variants.

## Manual release verification steps

1. Set `TAG`, normally like `v0.11.5`.
2. Download both release assets from `https://github.com/mickmister/beads-web/releases/download/$TAG/`:
   - `beads-web-linux-x64` for catalog platform key `linux-amd64`.
   - `beads-web-linux-arm64` for catalog platform key `linux-arm64`.
3. Compute sha256 locally from the downloaded bytes. Do not copy old hashes forward.
4. Confirm each asset exists and is an ELF binary. Running the binary may fail on the local host if the architecture differs; that is not itself a release verification failure.

Example:

```sh
tmp=$(mktemp -d)
cd "$tmp"
TAG=v0.11.5
for asset in beads-web-linux-x64 beads-web-linux-arm64; do
  curl -fL --retry 3 -o "$asset" \
    "https://github.com/mickmister/beads-web/releases/download/$TAG/$asset"
  sha256sum "$asset"
  file "$asset"
done
```

## Config rules

- Set plugin `version` to the release tag in all three JSON files. The refresh CLI does this automatically.
- Set the GitHub release installer `tag` to the same release tag. The refresh CLI does this automatically.
- Keep service wiring stable unless the release explicitly changes runtime needs:
  - command: `${PLUGIN_DIR}/bin/beads-web`
  - default HTTP port: `3109`
  - bind: `0.0.0.0`
  - env maps `HOST` to `${BEADS_WEB_PORT_BIND}` and `PORT` to `${BEADS_WEB_PORT}`
  - Caddy exposure: `beads-web.{$PROXY_DOMAIN}` via `httpExposure.subdomain = "beads-web"`
- Keep materialization stable: install the downloaded asset as `bin/beads-web` with mode `0755`.

## Validation

Run targeted tests first. On macOS, the full `plugin-service-orchestrator.test.ts` suite may fail before version assertions with `Unsupported plugin platform: darwin-*`; run the catalog-specific test locally and run the full orchestrator suite in a Linux/amd64 environment when available.

```sh
npm test -- --run \
  plugins/orchestrator/plugin-service-orchestrator.test.ts \
  -t 'imports the checked-in plugin catalog'

npm test -- --run \
  plugins/orchestrator/plugin-runtime-apply-script.test.ts \
  src/lib/pluginAdminApi.test.ts \
  src/server/plugin-admin-routes.test.ts
```

If files under `src/` changed, run:

```sh
npm run check-types
```

Before committing, run GitNexus change detection as required by repo instructions:

```sh
npx --yes gitnexus detect_changes
```

If `bd` is configured for the workspace, update or reference the relevant bead. If `bd where` reports no active beads workspace, note that in the final response.
