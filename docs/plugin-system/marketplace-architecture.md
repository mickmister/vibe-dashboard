# Plugin marketplace catalog and local installer architecture

This plan covers `vkvw-nzv5.6` — "Milestone 2: Marketplace catalog and local installer foundation".

## V1 split of responsibilities

### VD-local installer/server (Node)

Runs on the user's VD machine. It is the only component that writes plugin artifacts to disk.

Responsibilities:

- fetch marketplace catalog metadata from a configured catalog URL or local static fixture,
- download selected GitHub release assets,
- verify digest and detached signature before staging,
- safely unpack `tar.gz` bundles,
- store immutable installed artifacts locally,
- serve frontend assets from VD routes such as `/dashboard/plugins/:pluginId/frontend_assets/:assetPath`,
- expose install/status APIs to the app,
- never auto-enable a plugin after download; admin approval happens after verification and manifest review.

### Marketplace catalog API (future Cloudflare Workers)

Runs as a stateless metadata server backed by checked-in `plugins.json`.

Responsibilities:

- serve searchable/filterable marketplace entries,
- provide release asset URLs, checksums, signatures, and capability metadata,
- avoid storing downloaded artifacts locally in Workers; any future hosted artifact/cache path should use a binding such as R2,
- keep installation, signature validation, and local filesystem writes out of the Worker.

## Mattermost marketplace patterns to copy

Mattermost's marketplace uses static `plugins.json` as source of truth for plugin entries and release versions. Entries include manifest metadata, download URLs, release notes, icons, hosting/release-stage flags, platform-specific bundles, update timestamps, and detached signatures.

Signature flow to adapt:

1. Catalog entry carries a detached base64 signature next to the bundle URL.
2. Installer downloads the `.tar.gz` bundle and its signature metadata.
3. Installer verifies the detached signature before unpack/install.
4. Verification supports a built-in trusted marketplace public key plus optional admin-configured public keys.
5. Store the signature alongside the staged artifact so load-time revalidation can be required later.

VD should add explicit capability/restriction metadata that Mattermost does not model deeply enough for future frontend iframe RPC, Deno permission flags, and containerized backend units.

## Plugin bundle contract

A plugin release asset is a signed `tar.gz` containing:

```text
plugin.json
frontend/              # optional built frontend assets
backend/               # optional source/config for backend units
```

A valid plugin has frontend parts, backend parts, or both. It does not need both.

Minimal `plugin.json` shape:

```json
{
  "schemaVersion": 1,
  "id": "example.plugin",
  "version": "1.0.0",
  "displayName": "Example Plugin",
  "frontend": {
    "entry": "frontend/index.html",
    "sandbox": {
      "allowScripts": true,
      "allowSameOrigin": false
    }
  },
  "backend": {
    "units": [
      {
        "id": "indexer",
        "kind": "deno",
        "entry": "backend/indexer.ts",
        "permissions": {
          "allowRead": ["$PLUGIN_DATA_DIR"],
          "allowWrite": ["$PLUGIN_DATA_DIR"],
          "allowNet": ["api.github.com"]
        }
      },
      {
        "id": "worker",
        "kind": "container",
        "image": "ghcr.io/example/plugin-worker@sha256:...",
        "network": "none",
        "volumes": ["$PLUGIN_DATA_DIR:/data"]
      }
    ]
  }
}
```

## `plugins.json` catalog shape

The marketplace catalog should be static JSON that points at release assets rather than embedding artifacts:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "example.plugin",
      "displayName": "Example Plugin",
      "description": "Registers data-driven cards and optional backend jobs.",
      "homepageUrl": "https://github.com/example/example.plugin",
      "versions": [
        {
          "version": "1.0.0",
          "manifestUrl": "https://github.com/example/example.plugin/releases/download/v1.0.0/plugin.json",
          "assets": [
            {
              "kind": "bundle",
              "runtimeParts": ["frontend", "backend"],
              "url": "https://github.com/example/example.plugin/releases/download/v1.0.0/example.plugin-1.0.0.tar.gz",
              "sha256": "...",
              "signature": {
                "algorithm": "openpgp-detached",
                "url": "https://github.com/example/example.plugin/releases/download/v1.0.0/example.plugin-1.0.0.tar.gz.sig",
                "trustedKeyIds": ["vd-marketplace-v1"]
              }
            }
          ],
          "capabilities": {
            "frontend": {
              "sandbox": ["allow-scripts"]
            },
            "backend": {
              "deno": ["--allow-read=$PLUGIN_DATA_DIR"],
              "containers": ["ghcr.io/example/plugin-worker@sha256:..."]
            }
          },
          "updatedAt": "2026-06-11T00:00:00Z"
        }
      ]
    }
  ]
}
```

## Local artifact layout

Use immutable versioned directories and a separate enablement state:

```text
$VD_PLUGIN_HOME/
  catalog-cache/plugins.json
  artifacts/example.plugin/1.0.0/
    bundle.tar.gz
    bundle.tar.gz.sig
    plugin.json
    verified.json
    extracted/
      frontend/
      backend/
  enabled/example.plugin.json
```

`verified.json` records catalog URL, asset URL, sha256, signature key id, verification time, and extracted file list.

Safe extraction requirements:

- reject absolute paths and `..` traversal,
- reject symlinks/hardlinks for V1,
- enforce max file count and max unpacked bytes,
- require `plugin.json` at tar root,
- ensure the manifest id/version matches the selected catalog entry,
- preserve immutable artifact dirs; updates install into a new version directory.

## Same-origin frontend serving

After verification, the local server serves frontend files from the extracted immutable version:

```text
/dashboard/plugins/:pluginId/:version/frontend_assets/*
```

The iframe URL can point at:

```text
/dashboard/plugins/example.plugin/1.0.0/frontend_assets/index.html
```

Cache policy should be immutable for versioned assets. Enabled-plugin state maps `pluginId` to a verified version. If we need an unversioned convenience route, it should redirect to the immutable versioned URL.

Security notes:

- Prefer `sandbox="allow-scripts"` for untrusted frontend plugins.
- If Springboard-built plugin assets still require `allow-same-origin`, treat that as an explicit admin-approved capability or serve from a separate plugin origin.
- Future iframe RPC (`vkvw-5h68`) must authenticate by registered `contentWindow`, `frameId`, `pluginId`, nonce, and capability grants; do not rely on `event.origin` when running opaque-origin iframes. This branch only ships asset serving and iframe sandbox policy.

## Hono RPC vs tRPC

### Hono RPC

Pros:

- Fits an app already using Hono.
- Works naturally in Node and Cloudflare Workers.
- Smaller dependency surface and simpler route tests with `app.request()`.
- Good for resource-oriented installer APIs and static catalog routes.

Cons:

- Type inference is route/client-shape based and less expressive than tRPC for complex procedure contracts.
- More manual schema validation unless paired with a validator such as Zod.

Example:

```ts
const app = new Hono()
  .get('/api/v1/plugins', (c) => c.json(catalog.plugins))
  .post('/api/v1/plugins/:pluginId/install', async (c) => {
    const pluginId = c.req.param('pluginId');
    const result = await installer.install(pluginId);
    return c.json(result, 202);
  });

export type MarketplaceApp = typeof app;
```

Client:

```ts
const client = hc<MarketplaceApp>('/');
const plugins = await client.api.v1.plugins.$get();
await client.api.v1.plugins[':pluginId'].install.$post({ param: { pluginId } });
```

### tRPC on Hono

Pros:

- Excellent TypeScript inference for procedure inputs/outputs.
- Strong fit when the UI and API are both TS and mostly procedure-oriented.
- Middleware exists to mount tRPC under Hono for Workers/Node.

Cons:

- More framework surface area on top of Hono.
- Less transparent HTTP resource shape for download/install operations.
- Requires more care for non-TS clients or future external marketplace consumers.

Example:

```ts
const router = t.router({
  listPlugins: t.procedure.query(() => catalog.plugins),
  installPlugin: t.procedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => installer.install(input.pluginId)),
});

const app = new Hono().use('/trpc/*', trpcServer({ router }));
```

Recommendation: use Hono RPC for V1 installer/catalog APIs, with explicit schema validation for request bodies and catalog files. Reconsider tRPC only if the marketplace UI grows many TS-only procedures where inferred client ergonomics outweigh the extra dependency.

## TDD plan

1. Unit-test catalog schema validation with frontend-only, backend-only, and mixed plugins.
2. Unit-test safe tar extraction rejects traversal, absolute paths, symlinks, and manifest id/version mismatch.
3. Unit-test signature/checksum verification with fake keys and fixtures modeled after Mattermost's detached-signature flow.
4. Use MSW `setupServer` in Vitest to mock GitHub release asset downloads from the local installer.
5. Add a Vite UI e2e test that opens the marketplace, clicks install, and verifies the local installer staged the expected release asset.
6. In `vkvw-nzv5.7` — "Milestone 3: Sample app proves frontend and backend runtimes", run the staged frontend and backend plugin parts in a standalone sample app before transplanting code into production `src/`.

## Containerized backend plugin units

Container units are for backend plugin code that needs arbitrary binaries or long-running services. They complement, not replace, Deno units.

Schema additions for container units:

```json
{
  "id": "worker",
  "kind": "container",
  "image": "ghcr.io/example/plugin-worker@sha256:<digest>",
  "network": "none",
  "ports": [],
  "volumes": ["$PLUGIN_DATA_DIR:/data:rw"],
  "environment": ["PLUGIN_DATA_DIR"]
}
```

Runtime rules:

- Images must be pinned by digest and should come from GHCR for marketplace V1.
- Signed release metadata covers the plugin manifest, expected image references, and artifact checksums.
- The VD-local installer verifies release signatures before trusting runtime metadata.
- Plugin-supplied compose files are rejected in V1 until VD can generate/sanitize compose from admin-approved grants. Future compose support must reject local `build:` sections for marketplace plugins; plugin CI should publish prebuilt images.
- Admin review must show network mode, exposed ports, writable volumes, environment grants, and image digest per container unit.
- Pull the signed image references before creating containers; do not start containers during install.

Publishing CI expectations:

1. Build frontend/backend artifacts.
2. Build container images in CI and push to GHCR.
3. Record immutable image digest references in `plugin.json` and runtime metadata.
4. Package the plugin tarball containing manifest, frontend assets, backend source/config, and runtime metadata.
5. Produce detached signatures for the tarball and publish both bundle and signature as GitHub release assets.
6. Update `plugins.json` with bundle URL, sha256, signature URL/value, capability summary, and image digest references.

These rules follow the same least-responsibility model as Deno: Deno grants are explicit command-line flags; container grants are explicit network/volume/port/environment/image approvals.
