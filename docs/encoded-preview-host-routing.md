# Encoded preview host routing

Vibe Dashboard preview hosts use a first-level encoded hostname so Cloudflare TLS
and wildcard routing only need to cover `*.vibedashboard.dev`:

```text
preview-{workspace_id}-{slot}--{customer}.vibedashboard.dev
```

Example:

```text
preview-workspace-abc-1--mickmister.vibedashboard.dev
```

The double dash is the separator before the customer slug. Customer slugs must not
contain `--`, and preview slots are limited to `1..5` for the first capacity model.
The Caddy handler defaults to this `vibedashboard.dev` base domain via
`PREVIEW_BASE_DOMAIN`; local/dev deployments using another customer base domain
must set that variable explicitly.

## Runtime request flow

1. The public Cloudflare Worker receives the encoded preview host.
2. The Worker resolves the customer part to the canonical customer hostname and
   forwards traffic through the customer tunnel.
3. The Worker preserves the original encoded hostname in `X-Vibe-Requested-Host`
   and sends a shared secret in `X-Vibe-Preview-Secret`.
4. The custom Caddy `vk_preview_resolver` handler reads the requested hostname
   from `X-Vibe-Requested-Host` only when the shared secret matches. Otherwise,
   it ignores forwarded host headers and uses the actual request `Host`.
5. If the hostname matches the preview syntax, Caddy calls the local resolver API.
6. The resolver returns `ready` with an upstream, `starting`, `not_found`,
   `capacity_full`, or `failed`/`unavailable`.
7. Caddy proxies ready traffic or serves a startup/unavailable response.

## Resolver API

`vk_preview_resolver` sends a local-only JSON POST to the configured
`resolver_url`:

```json
{
  "host": "preview-workspace-abc-1--mickmister.vibedashboard.dev",
  "workspaceId": "workspace-abc",
  "slot": 1,
  "customer": "mickmister",
  "ensure": true,
  "method": "GET",
  "path": "/"
}
```

`ensure` is only true for page-load navigations: `GET`, not a protocol upgrade,
and `Sec-Fetch-Mode: navigate` or `Sec-Fetch-Dest: document`. Asset, API, and
WebSocket requests do not start preview servers by themselves.

Expected response:

```json
{ "status": "ready", "upstream": "http://127.0.0.1:4567" }
```

Other statuses:

- `starting`: render startup page for navigations, plain 503 for non-document requests.
- `not_found`: 404.
- `capacity_full`: 503.
- `failed`, `unavailable`, `error`: 502.

The resolver owns workspace validation, preview process state, max-running-server
capacity, and eviction policy. The Caddy module owns request parsing and proxying.

## Trusted Worker header

Direct clients can set arbitrary `X-Forwarded-Host` or `X-Vibe-Requested-Host`
headers, so Caddy must not use those headers as routing authority unless the
request came through the trusted Worker/proxy path. By default, the handler only
uses `Host`.

To enable the Worker canonical-host path, configure the same secret in both the
Worker and Caddy:

- Worker request to Caddy:
  - `X-Vibe-Requested-Host: preview-{workspace_id}-{slot}--{customer}.vibedashboard.dev`
  - `X-Vibe-Preview-Secret: <shared secret>`
- Caddy environment:
  - `PREVIEW_REQUESTED_HOST_SECRET=<shared secret>`

Advanced deployments may override the header names with
`PREVIEW_REQUESTED_HOST_HEADER` and `PREVIEW_REQUESTED_HOST_SECRET_HEADER`, or
the equivalent Caddyfile options `trusted_requested_host_header`,
`trusted_requested_host_secret_header`, and `trusted_requested_host_secret`.
