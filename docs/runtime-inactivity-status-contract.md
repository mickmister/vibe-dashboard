# Runtime inactivity status endpoint contract

This runtime image exposes a local-only diagnostic endpoint for the MTS inactivity
reporter:

```text
GET http://127.0.0.1:<app-port>/internal/inactivity/status
```

The endpoint is intentionally **not** a public/customer API. It returns 404 unless
the request is addressed to a loopback host (`127.0.0.1`, `localhost`, or `::1`)
and does not carry a public `X-Forwarded-For`/`X-Real-IP` value. The customer
runtime proxy must not expose it through customer hostnames.

## Response shape

The response is bounded, allowlisted JSON compatible with the MTS runtime
inactivity reporter:

```json
{
  "schemaVersion": "runtime-inactivity-status.v1",
  "isIdle": false,
  "idleReason": "recent_user_activity",
  "idleTimeoutMs": 900000,
  "activityDebounceMs": 5000,
  "lastUserActivityAt": "2026-09-02T19:55:00.000Z",
  "lastUserActivityType": "workspace_process_completed",
  "lastUserActivitySource": "vibe_kanban_workspace_summary",
  "hasRunningAgent": false,
  "agentStateKnown": true,
  "agentPollIntervalMs": 15000,
  "lastAgentPollAt": "2026-09-02T20:00:00.000Z",
  "lastSuccessfulAgentPollAt": "2026-09-02T20:00:00.000Z",
  "blockers": []
}
```

`idleTimeoutMs` defaults to the 15-minute pilot target. Automatic suspend remains
controlled by the MTS control-plane rollout flag; this endpoint only supplies
eligibility evidence. Billable compute must still end on a provider-confirmed
stop/destroy, not on this report.

## Signal semantics

The endpoint uses Vibe Kanban workspace summaries as the first local signal
source:

1. **Strong blockers** prevent an idle decision: running execution/agent,
   pending tool approval, running dev server, or unseen agent turns.
2. **Workspace activity** uses the latest completed workspace process timestamp
   as a safe activity timestamp.
3. **Unknown state fails safe**: if VK summaries are unavailable, empty, or lack a
   trusted activity timestamp, the endpoint returns `isIdle=false` with
   `activity_signal_unknown` and, where applicable, `vk_api_unavailable`.

The endpoint does not emit workspace names, repo names/URLs, prompts, commands,
file paths, environment variables, cookies, tokens, secrets, customer files, or
raw logs.

## Follow-ups

Browser/editor presence and terminal/file/process-level activity should be added
as explicit bounded signal sources before unattended full automatic teardown is
enabled. Until those signals are proven, pilot suspend remains operator-approved
and MTS auto-suspend remains default-off.
