# Mattermost Dev Stack

This directory holds a repo-local Mattermost stack for integration testing.

It is adapted from the upstream Mattermost Apps examples compose file:

- `https://github.com/mattermost/mattermost-app-examples/blob/master/docker-compose.yml`

## Files

- `docker-compose.yml`: Mattermost + Postgres stack
- `.docker.env.example`: optional upstream env file template
- `mmctl.sh`: convenience wrapper for running `mmctl` inside the Mattermost container

## Local setup

The stack expects a `.docker.env` file because the upstream compose uses `env_file`.
The checked-in example is sufficient for local testing.

```bash
cd vibe-kanban-vscode-web/integrations/mattermost
cp .docker.env.example .docker.env
docker compose up -d
```

Mattermost will be available at:

- `http://localhost:8065`

## mmctl

`mmctl` is not installed on the host in this workspace. Use the wrapper so commands run against the bundled binary inside the Mattermost container:

```bash
./mmctl.sh version
./mmctl.sh --local system status
```

Local mode is enabled in the container, so `--local` works without creating a user session first.

## Useful commands

```bash
docker compose ps
docker compose logs -f mattermost
docker compose down
```

## VK webhook delivery

The bridge exposes `POST /api/mattermost/vk-webhook` by default. Configure VK's
Generic webhook URL to point at this route and set the same signing secret in
both places:

- VD: `MATTERMOST_BRIDGE_VK_WEBHOOK_SECRET`
- VK webhook configuration: `Signing Secret`

VK sends `X-VK-Webhook-Timestamp` and `X-VK-Webhook-Signature` headers using
HMAC-SHA256 over `<timestamp>.<raw-json-body>`. The bridge rejects invalid or
stale signatures when a secret is configured, deduplicates by `delivery_id`, and
uses webhook execution events as the primary running/idle session signal. The
Mattermost websocket/reconciliation loops remain as the inbound Mattermost post
transport and VK summary polling remains a fallback reconciliation signal.
