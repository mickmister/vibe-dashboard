# vibe-kanban + code-server + Caddy (Docker)

Single-container setup that runs:

- `vibe-kanban` on `3007`
- `code-server` (VS Code in the browser) on `3008`
- `caddy` as the main entrypoint on `3001`

## Quick start

`code-server` runs without built-in auth by default. If you want a login prompt, set `CODE_PASSWORD`:

```bash
export CODE_PASSWORD='change-me'
```

Build and run:

```bash
docker compose up --build
```

Open:

- `http://localhost:${CADDY_PORT:-3001}` (main entrypoint via Caddy)

## Dynamic port forwarding

Caddy forwards `port-<port>.*` subdomains to `localhost:<port>` inside the container:

- `http://port-12345.localhost:${CADDY_PORT:-3001}/`

## RunPod

RunPod Pods do not support Docker Compose directly, so the RunPod variant uses a single container image plus `supervisord`. It also symlinks mutable state into `/workspace`, because RunPod preserves pod volume or network-volume data there across stops/restarts while container-disk data is wiped.

Use `Dockerfile.runpod` for this deployment target:

```bash
docker build -f Dockerfile.runpod -t vk-vd-runpod .
```

Then set the pod start command to the image default (or explicitly run `/usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf`) and expose port `3001/http`.

## Configuration

Environment variables are split across:

- `docker-compose.yaml` (local dev container)
- `vkcloud/docker-compose.yaml` (self-hosted VK cloud stack)

### Local dev container (`docker-compose.yaml`)

#### Optional auth

| Variable | Default | Notes |
| --- | --- | --- |
| `CODE_PASSWORD` | empty | Optional. If set, `code-server` starts with password auth. If empty/unset, it starts with `--auth none`. |

#### Image/version

| Variable | Default | Notes |
| --- | --- | --- |
| `VIBE_KANBAN_VERSION` | `latest` | Build arg and runtime env for `vibe-kanban` version. |

#### Ports

| Variable | Default | Notes |
| --- | --- | --- |
| `CADDY_PORT` | `3001` | Main Caddy entrypoint host port. |
| `BACKEND_PORT` | `3007` | Backend port exposed inside container env. |
| `DASHBOARD_PORT` | `3005` | Dashboard port exposed inside container env. |
| `CODE_PORT` | `3008` | `code-server` port exposed inside container env. |

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
| `MEMORY_WATCHDOG_ENABLED` | `false` | Enables the supervisor-managed memory watchdog. |
| `MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL` | empty | Mattermost incoming webhook URL used for notifications. |
| `MEMORY_WATCHDOG_PROCESS_THRESHOLD_MB` | `4096` | Per-process RSS threshold in MiB. |
| `MEMORY_WATCHDOG_TOTAL_THRESHOLD_PERCENT` | `60` | Host memory threshold based on `MemAvailable` from `/proc/meminfo`. |
| `VK_SHARED_API_BASE` | empty | If set, local VK connects to that cloud API base URL. |
| `VK_ALLOWED_ORIGINS` | empty | Optional backend CORS allowlist. |
| `ENABLE_BOSUN` | `false` | Present as a commented option in compose. |

## Memory watchdog

The container now includes a supervisor-managed watchdog at [scripts/memory-watchdog.mjs](/Users/mickmister/code/vibe-kanban-vscode-web/scripts/memory-watchdog.mjs) that can post to a Mattermost incoming webhook when:

- host memory usage rises above `MEMORY_WATCHDOG_TOTAL_THRESHOLD_PERCENT`
- any individual process exceeds `MEMORY_WATCHDOG_PROCESS_THRESHOLD_MB`

Threshold detection uses `/proc/meminfo` and `ps` RSS data directly. `free -h` and `top -b -n 1` are attached only as diagnostic snapshots when an alert fires, which is more stable than parsing their human-oriented output continuously.

### VK cloud stack (`vkcloud/docker-compose.yaml`)

#### Core required (typical production)

| Variable | Default | Notes |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | none (required in practice) | Public URL used by server and frontend (`SERVER_PUBLIC_BASE_URL`, `VITE_*`). |
| `VIBEKANBAN_REMOTE_JWT_SECRET` | none (required) | JWT signing secret for remote server auth. |
| `GITHUB_OAUTH_CLIENT_ID` | none (required unless another provider is configured) | GitHub OAuth client ID. |
| `GITHUB_OAUTH_CLIENT_SECRET` | none (required unless another provider is configured) | GitHub OAuth client secret. |

#### Deployment/image/runtime

| Variable | Default | Notes |
| --- | --- | --- |
| `VKCLOUD_IMAGE_VERSION` | `latest` | Tag for `ghcr.io/mickmister/vk-cloud`. |
| `REMOTE_SERVER_PORTS` | `127.0.0.1:3000:8081` | Docker port mapping for `vk-remote`. |
| `RUST_LOG` | `info,remote=info` | Server logging level/filter. |

#### Postgres + ElectricSQL

| Variable | Default | Notes |
| --- | --- | --- |
| `VK_POSTGRES_DB` | `remote` | Postgres database name. |
| `VK_POSTGRES_USER` | `remote` | Postgres user. |
| `VK_POSTGRES_PASSWORD` | `remote` | Postgres password. |
| `ELECTRIC_ROLE_PASSWORD` | `remote` | Password used by ElectricSQL role. |

#### OAuth (optional additions)

| Variable | Default | Notes |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | empty | Optional Google OAuth provider. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | empty | Optional Google OAuth provider. |

#### Azure storage (Azurite by default)

| Variable | Default | Notes |
| --- | --- | --- |
| `AZURE_STORAGE_ACCOUNT_NAME` | `devstoreaccount1` | Storage account name. |
| `AZURE_STORAGE_ACCOUNT_KEY` | Azurite dev key | Storage account key. |
| `AZURE_STORAGE_CONTAINER_NAME` | `issue-attachments` | Blob container for attachments. |
| `AZURE_STORAGE_ENDPOINT_URL` | `http://vk-azurite:10000/devstoreaccount1` | Internal storage endpoint. |
| `AZURE_STORAGE_PUBLIC_ENDPOINT_URL` | `http://localhost:10000/devstoreaccount1` | Public/client-facing storage endpoint. |

#### Optional integrations

| Variable | Default | Notes |
| --- | --- | --- |
| `LOOPS_EMAIL_API_KEY` | empty | Loops email integration. |
| `GITHUB_APP_ID` | empty | GitHub App integration ID. |
| `GITHUB_APP_PRIVATE_KEY` | empty | GitHub App private key. |
| `GITHUB_APP_WEBHOOK_SECRET` | empty | GitHub App webhook secret. |
| `GITHUB_APP_SLUG` | empty | GitHub App slug. |
| `R2_ACCESS_KEY_ID` | empty | Cloudflare R2 credentials. |
| `R2_SECRET_ACCESS_KEY` | empty | Cloudflare R2 credentials. |
| `R2_REVIEW_ENDPOINT` | empty | R2 endpoint for reviews. |
| `R2_REVIEW_BUCKET` | empty | R2 bucket for reviews. |
| `REVIEW_WORKER_BASE_URL` | empty | External review worker service URL. |
| `STRIPE_SECRET_KEY` | empty | Stripe secret key. |
| `STRIPE_TEAM_SEAT_PRICE_ID` | empty | Stripe price ID for team seats. |
| `STRIPE_WEBHOOK_SECRET` | empty | Stripe webhook signing secret. |
| `STRIPE_FREE_SEAT_LIMIT` | `1` | Free seat limit for Stripe-based plans. |

#### Local image build args (only if you switch from `image:` to `build:`)

| Variable | Default | Notes |
| --- | --- | --- |
| `VK_REPO_URL` | `https://github.com/BloopAI/vibe-kanban.git` | Source repo used by local image build. |
| `VK_BRANCH` | `v0.1.15-20260218201323` | Git branch/tag used by local image build. |
| `FEATURES` | empty | Optional feature flags passed at build time. |
| `POSTHOG_API_KEY` | empty | Optional PostHog key passed at build time. |
| `POSTHOG_API_ENDPOINT` | empty | Optional PostHog endpoint passed at build time. |

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

The container includes Docker CLI and mounts the host's Docker socket at `/var/run/docker.sock`. This allows you to run Docker commands from within the VSCode environment.

**What this means:**
- You can run `docker build`, `docker run`, `docker compose`, etc. from the terminal in VSCode
- Containers you create will run on the host's Docker daemon (not inside this container)
- Images built are stored on the host system
- This approach is more secure than true Docker-in-Docker (no privileged mode required)

**How it works:**
- The container automatically detects the GID of the mounted Docker socket at startup
- The docker group inside the container is created/updated to match the host's docker group GID
- This ensures `vkuser` has permission to access the socket without requiring privileged mode

**Example usage:**
```bash
# Check Docker is available
docker --version

# Build and run containers
docker build -t myapp .
docker run -p 8080:8080 myapp

# Use Docker Compose
docker compose up -d
```

**Security note:** The mounted Docker socket gives this container the ability to create and manage containers on the host. Only use this environment in trusted contexts.

## Increasing inotify limits

If you're working with large projects, you may hit inotify limits (file watcher errors). These are kernel-level settings inherited from the Docker host.

Check current values on the host:

```bash
cat /proc/sys/fs/inotify/max_user_watches    # default: 8192
cat /proc/sys/fs/inotify/max_user_instances  # default: 128
```

To increase (on the Docker host, not in the container):

```bash
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
echo fs.inotify.max_user_instances=512 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

No container restart required - changes take effect immediately.
