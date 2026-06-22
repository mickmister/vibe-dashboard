# Vibe Dashboard

A coding agent dashboard built on top of https://vibekanban.com and https://github.com/coder/code-server

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

## GitHub auth

Run `gh auth login` once after first starting the container. Git is pre-configured to use `gh` as the credential helper, so no additional setup is needed.

Credentials persist in the `gh-config` volume at `/home/vkuser/.config/gh`.

To set your Git identity (also persisted):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Codex auth

Codex caches credentials in `~/.codex/auth.json` when configured for file-based storage; this is persisted via the `codex-data` Docker volume mounted at `/home/vkuser/.codex`.

## Docker-in-Docker support

The container includes Docker CLI and mounts the host's Docker socket at `/var/run/docker.sock`. This allows agents to run docker commands and you to run Docker commands from within the VSCode environment.

**Security note:** The mounted Docker socket gives this container the ability to create and manage containers on the host. Only use this environment in trusted contexts. Remove the docker socket volume in the compose file to disable this.
