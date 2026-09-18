---
name: vibe-dashboard-preview-urls
description: Create, reuse, and present Vibe Dashboard Preview URLs when introducing a browser-reviewable service such as Vite or Storybook, producing static HTML for review, or responding to a request to show, open, or review UI. Do not use for unrelated backend-only work.
---

# Vibe Dashboard Preview URLs

Use stored run configs and preview slots to give the user a stable browser URL. Prefer a suitable existing described config over creating a duplicate.

## Discover before changing configuration

Obtain the current workspace ID from `VK_WORKSPACE_ID` when available. Then inspect the attached repositories and all existing PreviewServer records as JSON:

```sh
vk workspace-repos <workspace-id> --json
vk preview-url list <workspace-id> --json
```

Match the current repo ID and read each run config and preview slot `description`. Reuse a record when its repo, command, service purpose, and slot identity fit the requested review. Do not infer IDs from names or create another record merely because a friendly name differs.

## Create or update stored records

Run configs describe how to start a browser-reviewable service. Use a command that binds its HTTP server to a reachable interface; for example, configure Vite or Storybook with `--host 0.0.0.0`. Describe the purpose and expected content.

```sh
vk preview-url upsert-run-config <workspace-id> \
  --repo <repo-id> --slug web --name "Web app" \
  --description "Vite app for interactive UI review" \
  --command "pnpm dev --host 0.0.0.0" --json
```

To update an existing config, include its returned ID with `--id <run-config-id>`. Preserve the ID instead of relying on duplicate-slug behavior.

Create or update a stable preview slot linked to that run config:

```sh
vk preview-url upsert-slot <workspace-id> \
  --repo <repo-id> --run-config <run-config-id> \
  --slot web --title "Web app" \
  --description "Primary browser review URL for the Vite app" --json
```

Use `--id <preview-slot-id>` when updating an existing slot. Static HTML still needs an HTTP command (for example `python3 -m http.server "$PORT" --bind 0.0.0.0 --directory dist`); Preview URLs proxy HTTP services, not files directly. The process receives its assigned port through `PORT`.

## Start, inspect, and present

Start the slot and retain the returned `execution_process.id` for explicit log or stop actions:

```sh
vk preview-url start-slot <workspace-id> <preview-slot-id> --json
vk preview-url url <workspace-id> <preview-slot-id> --customer <customer-slug> --json
```

The canonical hostname grammar is:

```text
{slotSlug}-{repoSlug}-{workspaceToken}-{customerSlug}.{baseDomain}
```

Present the returned `url` exactly; do not assemble production URLs yourself.

Logs are fetched only when needed:

```sh
vk preview-url logs <process-id> --json --timeout 2000
```

Stop the linked process when requested or when a temporary review service should no longer run:

```sh
vk preview-url stop <process-id>
```

Restart by stopping the current process, then running `start-slot` again and using the newly returned process ID.

## Local Caddy review

Local generated `*.localhost` Preview URLs require the dedicated loopback-only Caddy command; `vk dev-server start` does not provide this routing:

```sh
vk preview-url local-caddy start --dashboard-port <vd-port> --backend-port <vk-port> --caddy-port 3001 --json
vk preview-url url <workspace-id> <preview-slot-id> --customer preview --local-caddy-port 3001 --json
vk preview-url local-caddy status --json
vk preview-url local-caddy stop --json
```

If startup reports an option mismatch, stop the existing local Caddy instance before restarting with the intended ports. If a Preview URL fails, inspect the slot/config linkage with `preview-url list`, then explicitly fetch logs using the authoritative process ID returned by a start command or exposed by VD. Do not trust or fabricate arbitrary process IDs.

## Boundaries

- Preview URL requested-host routing is approved only for the private, Cloudflare Access-protected sandbox until per-customer attestation is implemented.
- Never expose the private origin directly or weaken requested-host checks.
- Do not push, deploy, open a browser, or mutate unrelated records without the user's authorization.
