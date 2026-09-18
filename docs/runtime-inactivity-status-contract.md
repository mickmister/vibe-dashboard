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
  "lastUserActivityType": "browser_editor_activity",
  "lastUserActivitySource": "browser_activity_beacon",
  "hasRunningAgent": false,
  "agentStateKnown": true,
  "agentPollIntervalMs": 15000,
  "lastAgentPollAt": "2026-09-02T20:00:00.000Z",
  "lastSuccessfulAgentPollAt": "2026-09-02T20:00:00.000Z",
  "blockers": ["browser_editor_present"],
  "browserActivity": {
    "signalKnown": true,
    "lastActivityAt": "2026-09-02T19:55:00.000Z",
    "lastSignalAt": "2026-09-02T19:55:00.000Z",
    "presenceExpiresAt": "2026-09-02T19:56:30.000Z"
  }
}
```

`idleTimeoutMs` defaults to the 15-minute pilot target. Automatic suspend remains
controlled by the MTS control-plane rollout flag; this endpoint only supplies
eligibility evidence. Billable compute must still end on a provider-confirmed
stop/destroy, not on this report.

## Signal semantics

The endpoint combines an explicit browser/editor activity beacon with Vibe
Kanban workspace summaries:

1. **Browser/editor activity** is reported by the app shell via
   `POST /internal/inactivity/browser-activity`. The payload is an allowlisted
   event category (`load`, `visible`, `focus`, `interaction`, `heartbeat`,
   `hide`, `pagehide`), an ISO timestamp, and a coarse visibility state only.
   URLs, paths, commands, prompts, file names, repo names, cookies, and tokens
   are never sent.
2. **Recent browser/editor presence** prevents an idle decision while the latest
   active beacon is inside the short presence TTL. Once the tab/editor stops
   heartbeating, the last activity timestamp can age past the 15-minute policy
   threshold and become eligible evidence.
3. **Strong VK blockers** prevent an idle decision: running execution/agent,
   pending tool approval, running dev server, or unseen agent turns.
4. **Workspace activity** uses the latest completed workspace process timestamp
   as a safe secondary activity timestamp.
5. **Unknown explicit presence fails safe**: if the browser/editor beacon has
   never been observed since process start, the endpoint returns `isIdle=false`
   with `browser_activity_unknown`. If VK summaries are unavailable, empty, or
   lack a trusted activity timestamp, it also returns `activity_signal_unknown`
   and, where applicable, `vk_api_unavailable`.

The endpoint does not emit workspace names, repo names/URLs, prompts, commands,
file paths, environment variables, cookies, tokens, secrets, customer files, or
raw logs.

## Follow-ups

Terminal/file/process-level activity can be added later as additional bounded
signal sources. Until this explicit browser/editor signal is baked into a live
runtime image and validated with the MTS reporter/suspend loop, pilot suspend
remains operator-approved and MTS auto-suspend remains default-off.
