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

The workspace runs Docker inside the dev container with Sysbox instead of mounting the host Docker socket. `docker-compose.yaml` sets `runtime: sysbox-runc`, persists the inner daemon at `/var/lib/docker`, and intentionally does **not** mount `/var/run/docker.sock` from the host.

Platform notes:

- Linux amd64/arm64: install Sysbox on the Docker host, then start the stack normally. Sysbox publishes amd64 and arm64 Linux packages.
- Mac amd64/arm64: use Docker Desktop with Enhanced Container Isolation enabled. Docker Desktop uses Sysbox for user containers in that mode and ignores explicit `--runtime` flags.

If the host does not provide Sysbox, container startup should fail rather than silently falling back to the host Docker socket.
