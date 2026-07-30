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

## Runtime request flow

1. The public Cloudflare Worker receives the encoded preview host.
2. The Worker resolves the customer part to the canonical customer hostname and
   forwards traffic through the customer tunnel.
3. The Worker preserves the original encoded hostname in `X-Vibe-Requested-Host`
   and `X-Forwarded-Host`.
4. The custom Caddy `vk_preview_resolver` handler reads the requested hostname
   from `X-Vibe-Requested-Host`, then `X-Forwarded-Host`, then `Host`.
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
