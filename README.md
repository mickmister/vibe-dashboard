# Vibe Dashboard

A coding agent dashboard built on top of https://github.com/BloopAI/vibe-kanban and https://github.com/coder/code-server

## Quick start

1. Run `docker compose up`
2. Open http://localhost:3001 in your browser

A docker container will run the following:

- `vibe-kanban`
- `code-server`
- `caddy` as the main UI entrypoint

## Dynamic port forwarding

Caddy forwards `port-<port>.*` subdomains to `localhost:<port>` inside the container:

- `http://port-12345.localhost:3001`

## Configuration

### Local dev container (`docker-compose.yaml`)

#### Optional auth

| Variable | Default | Notes |
| --- | --- | --- |
| `CODE_PASSWORD` | empty | Optional. If set, `code-server` starts with password auth. If empty/unset, it starts with `--auth none`. |

#### Image/version

| Variable | Default | Notes |
| --- | --- | --- |
| `VKVD_IMAGE_VERSION` | `latest` | Fetches image from ghcr.io/mickmister/vk-vd:${VKVD_IMAGE_VERSION:-latest}. The compose file's pull policy is set to "always", so if you want to pin a specific version, use this arg. |

#### Ports

| Variable | Default | Notes |
| --- | --- | --- |
| `CADDY_PORT` | `3001` | Main Caddy entrypoint host port. |
| `BACKEND_PORT` | `3007` | Backend service port inside the container. Not published directly by compose. |
| `DASHBOARD_PORT` | `3005` | Dashboard service port inside the container. Not published directly by compose. |
| `CODE_PORT` | `3008` | `code-server` service port inside the container. Not published directly by compose. |

#### Optional auth/system

| Variable | Default | Notes |
| --- | --- | --- |
| `SUDO_PASSWORD` | empty | Optional sudo password in the container. |

#### Optional networking/integration

| Variable | Default | Notes |
| --- | --- | --- |
| `ENABLE_TAILSCALE` | `false` | Enables Tailscale startup. |
| `TAILSCALE_AUTHKEY` | empty | Tailscale auth key. |
| `TAILSCALE_HOSTNAME` | `vkdev` | Tailscale node hostname. |
| `VK_ALLOWED_ORIGINS` | empty | Optional backend CORS allowlist. |

#### Optional Vibe Kanban performance tracing / SigNoz

Tracing is disabled by default. To export Vibe Kanban performance spans from
the container to SigNoz, set `VK_PERF_TRACING=1` and an OTLP endpoint in your
`.env` before running `docker compose up`:

```bash
VK_PERF_TRACING=1
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.<region>.signoz.cloud:443
OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=<your-ingestion-key>
OTEL_SERVICE_NAME=vibe-kanban-backend
OTEL_RESOURCE_ATTRIBUTES=service.version=local-compose
```

Use `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` if traces should use a different
endpoint from other OTLP signals. `OTEL_EXPORTER_OTLP_HEADERS` is needed for
SigNoz Cloud auth, but is usually unnecessary for a local collector.
`VK_WS_POLL_TRACING=1` enables extra noisy WebSocket poll tracing and is not
normally needed.

#### Optional noVNC/Chromium sidecar

The browser sidecar is opt-in. Start it alongside the plugin with:

```bash
COMPOSE_PROFILES=novnc ENABLE_NOVNC_PLUGIN=true docker compose up
```

The noVNC UI and Chromium CDP ports are bound to localhost only. Chromium intentionally binds CDP to loopback inside the sidecar; the `novnc-cdp` bridge exposes it to the Compose network and localhost-published host port. Set `NOVNC_USER` and `NOVNC_PASSWORD` if you want browser UI auth.

Smoke-check CDP from the host and from `code-vibe`:

```bash
curl -fsS http://127.0.0.1:${NOVNC_CDP_PORT:-9223}/json/version
docker compose --profile novnc exec code-vibe curl -fsS http://novnc:9222/json/version
```

| Variable | Default | Notes |
| --- | --- | --- |
| `NOVNC_UI_PORT` | `3090` | Host localhost port for the noVNC web UI. |
| `NOVNC_CDP_PORT` | `9223` | Host localhost port for Chromium DevTools Protocol. |
| `NOVNC_USER` | empty | Optional noVNC UI username. |
| `NOVNC_PASSWORD` | empty | Optional noVNC UI password. |
| `NOVNC_IMAGE` | `lscr.io/linuxserver/chromium:latest` | Browser sidecar image. |


## GitHub auth

Run `gh auth login` once after first starting the container. Git is pre-configured to use `gh` as the credential helper, so no additional setup is needed.

Credentials persist in the `gh-config` volume at `/home/vkuser/.config/gh`.

To set your Git identity (also persisted):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Testing

Run type checks and unit tests:

```bash
npm run check-types
npm test
```

Run Playwright e2e tests:

```bash
npm run test:e2e:install
npm run test:e2e
```

If port `4173` is already in use locally, choose a different isolated e2e port:

```bash
E2E_PORT=4273 npm run test:e2e
```

## Codex auth

Codex caches credentials in `~/.codex/auth.json` when configured for file-based storage; this is persisted via the `codex-data` Docker volume mounted at `/home/vkuser/.codex`.

## Docker-in-Docker support

The container includes Docker CLI and mounts the host's Docker socket at `/var/run/docker.sock`. This allows agents to run docker commands and you to run Docker commands from within the VSCode environment.

**Security note:** The mounted Docker socket gives this container the ability to create and manage containers on the host. Only use this environment in trusted contexts. Remove the docker socket volume in the compose file to disable this.
