# Inactivity detection for external teardown

## Goal

Provide a local source of truth for whether the `vibe-kanban-vscode-web`
container should be considered idle, so an external controller can tear down the
whole server aggressively and safely.

## Rules

- A running VK agent turn always blocks idle.
- Otherwise the container is idle when there has been no qualifying user action
  for the configured timeout window.
- Open WebSocket connections alone do **not** count as activity.
- Passive viewing with no recent user action is idle once the timeout elapses.

## End-to-end design

### 1. Browser activity beacons

The wrapper app emits lightweight POST beacons to
`/internal/inactivity/activity` for:

- window focus
- pointer down
- key down
- wrapper navigation actions
- same-origin iframe focus / pointer down / key down

Same-origin iframe monitoring is important because a user may spend most of
their time inside the VK or code-server iframe rather than the wrapper chrome.

### 2. Server-side activity tracker

An internal sidecar HTTP server runs inside the dashboard Node process and keeps
an in-memory state containing:

- last user activity timestamp
- last user activity type/source
- whether VK currently has any running agent turns
- last successful VK poll timestamp

The tracker is intentionally in-memory only. If the dashboard process restarts,
the container is effectively fresh again and can rebuild state naturally.

### 3. VK running-agent poller

The inactivity server polls VK summaries:

- `POST {VK_BASE_URL}/workspaces/summaries`

and treats the container as active whenever any workspace reports
`latest_process_status === "running"`.

V1 stays local to `vibe-kanban-vscode-web` and does not require VK source
changes.

### 4. External status endpoint

The inactivity server exposes:

- `GET /internal/inactivity/status`

This endpoint is reverse proxied through Caddy so both the wrapper UI and an
external controller can reach it on the main host.

Example response shape:

```json
{
  "isIdle": false,
  "idleReason": "recent_user_activity",
  "idleTimeoutMs": 300000,
  "activityDebounceMs": 5000,
  "lastUserActivityAt": "2026-05-11T18:00:00.000Z",
  "lastUserActivityType": "iframe_key_down",
  "lastUserActivitySource": "iframe",
  "hasRunningAgent": false,
  "agentStateKnown": true,
  "agentPollIntervalMs": 15000,
  "lastAgentPollAt": "2026-05-11T18:00:10.000Z",
  "lastSuccessfulAgentPollAt": "2026-05-11T18:00:10.000Z",
  "backendBaseUrl": "http://127.0.0.1:3007/api",
  "computedAt": "2026-05-11T18:00:12.000Z"
}
```

## Idle decision

The server computes:

- if any agent is running: `isIdle = false`
- else if `now - lastUserActivityAt >= INACTIVITY_IDLE_TIMEOUT_MS`:
  `isIdle = true`
- else `isIdle = false`

## Configuration

Environment variables:

- `INACTIVITY_IDLE_TIMEOUT_MS` (default `300000`)
- `INACTIVITY_ACTIVITY_DEBOUNCE_MS` (default `5000`)
- `INACTIVITY_AGENT_POLL_INTERVAL_MS` (default `15000`)
- `INACTIVITY_PORT` (default `3011`)
- `INACTIVITY_SERVER_HOST` (default `127.0.0.1`)
- `INACTIVITY_VK_BASE_URL` (default `http://127.0.0.1:${BACKEND_PORT:-3007}/api`)

## Why this architecture

- Keeps V1 local to `vibe-kanban-vscode-web`
- Avoids treating passive network noise as real activity
- Lets the external controller poll a single HTTP contract
- Leaves room for future VK-side richer activity signals

## Future improvements

- Add VK-native fine-grained “user interacted recently” signals
- Include explicit browser visibility heuristics if needed
- Add auth or signed requests for the inactivity endpoints if exposure becomes a
  concern
