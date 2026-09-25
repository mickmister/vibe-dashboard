# VD Auto-Nudge Implementation Plan

Bead: `vkvw-ca0e` — Decide VD auto-nudge monitor requirements

## Goal

Build a TypeScript monitor that periodically inspects a configured set of Vibe Kanban workspaces and nudges the correct agent/session when the workflow coordination ball is dropped.

The monitor must use the existing `vibe-agent` source/client APIs rather than shelling out to `vk`/`vibe-agent` for core behavior.

## Confirmed Requirements

- Startup accepts a JSON config via flag, e.g. `--config ./auto-nudge.json`.
- Config contains:
  - `workspaces: [{ workspaceId, overseerSessionId }]`
  - Discord enabled via environment, not JSON.
- Required env:
  - `VK_ORIGIN`, used to build workspace URLs: `${VK_ORIGIN}/workspaces/:workspaceId`
- Optional env:
  - `DISCORD_WEBHOOK_URL`, required only when Discord alerting is enabled/needed.
- Default poll interval: 5 minutes.
- Teammate nudges must be fire-and-forget, not request/response.
- Overseer base-case prompt must use request/response semantics so the monitor can inspect the reply.
- Exact trimmed overseer response `DONE` means the workspace is terminally complete for the monitor.
- Non-overseer interrupted terminal turns should receive exactly:
  - `Please continue`
- Do **not** send `vibe-agent full_summary` catch-up nudges.
- If a rate/usage/overuse condition is detected, send at most one Discord alert per event and do not keep messaging the affected agent for that event.
- Never log or persist `DISCORD_WEBHOOK_URL`.

## Existing Code to Reuse

Current implementation foundation:

- `scripts/vibe-agent/core/client.ts`
  - `getWorkspace`
  - `getSessions`
  - `getSessionProcesses`
  - `fetchConversation`
  - `sendMessage`
- `scripts/vibe-agent/nudge/criteria.ts`
  - terminal process detection
  - active process detection
  - final assistant message detection
  - nudge prompt detection
- Existing tests:
  - `scripts/vibe-agent/nudge/criteria.test.ts`
  - `scripts/vibe-agent/nudge/auto-nudge.test.ts`

Prefer extending the configured auto-nudge scanner rather than reviving the removed legacy nudge daemon.

## Proposed CLI

Add a new built artifact entry such as:

```bash
node dist/vibe-agent/nudge/auto-nudge.js --config /path/to/auto-nudge.json
```

Potential flags:

```bash
--config <path>              Required.
--state <path>               Optional; default /var/lib/vd/auto-nudge/state.json.
--poll-ms <ms>               Optional override; default 300000.
--once                       Run one cycle and exit; useful for tests/smoke checks.
--dry-run                    Decide and log actions without sending messages or Discord.
```

Do not require `--respond` for teammate nudges. The implementation should use the lower-level client equivalent.

## Proposed Config Schema

```json
{
  "discord": {
    "enabled": true
  },
  "workspaces": [
    {
      "workspaceId": "eddf9844-3d2c-4196-b4cc-114e3ab6c63d",
      "overseerSessionId": "7f5b498a-9d68-4a2d-91a5-c6bb9404dc09"
    }
  ]
}
```

Validation rules:

- `workspaces` must be a non-empty array.
- Each `workspaceId` and `overseerSessionId` must be a non-empty string.
- `workspaceId` values should be unique.
- `overseerSessionId` values should be unique per workspace unless deliberately allowed later.
- If `discord.enabled === true`, `DISCORD_WEBHOOK_URL` must be available when an alert is about to be sent.
- `VK_ORIGIN` must always be available and parse as a URL origin/base.

Do not allow webhook URLs in JSON.

## Durable State

Persist state to avoid repeated nudges/alerts across daemon restarts.

Suggested state:

```ts
type AutoNudgeState = {
  version: 1;
  completedWorkspaceIds: string[];
  nudgedProcessIds: string[];
  overseerPromptProcessIds: string[];
  discordAlertEventIds: string[];
  lastObservedByWorkspace: Record<
    string,
    {
      lastCycleAt: string;
      lastOverseerDoneAt?: string;
    }
  >;
};
```

Event IDs should be deterministic and non-secret, for example:

- `rate-limit:${workspaceId}:${sessionId}:${processId}:${eventTimestampOrIndex}`
- `nudge:${workspaceId}:${sessionId}:${processId}`
- `overseer:${workspaceId}:${triggerProcessId}`

State retention can initially be append-only with periodic pruning of very old IDs as a follow-up if needed.

## Core Inspection Algorithm

For each configured workspace:

1. Load workspace and configured sessions.
2. Load all sessions for the workspace.
3. Identify:
   - configured overseer session by `overseerSessionId`
   - non-overseer sessions as all other workspace sessions
4. Fetch recent processes per relevant session.
5. If any relevant session currently has an active/running process:
   - do not send to that session.
   - continue inspecting other sessions if safe.
6. Inspect transcripts/log entries for structured Codex rate/usage/overuse signals.
7. If a rate/usage/overuse event is found:
   - send one Discord alert for that event.
   - do not send another message for that event.
8. For non-overseer sessions:
   - if latest relevant process is terminal `failed`/`killed`, has progress evidence, and lacks a final assistant response:
     - if not already nudged, send `Please continue`.
9. For non-overseer completed turns:
   - if a non-overseer completed and no overseer follow-up occurred within 1 minute:
     - send the overseer base-case prompt with request/response semantics.
     - if response trimmed exactly equals `DONE`, mark workspace complete in state and stop nudging it.
10. For callback-aware cases:
   - if transcript indicates `vibe-agent callback` was used, avoid nudging while the callback wait is still plausibly pending.
   - when callback completion is observed and no follow-up occurs within 1 minute, route through the same direct/overseer rules.

## Definitions

### Terminal No-Final-Response

Reuse existing criteria from `criteria.ts`:

- process `run_reason === "codingagent"`
- process terminal: `failed` or `killed`, or equivalent terminal completion
- entries contain `tool_use`, `thinking`, partial assistant stream, or other progress evidence
- no substantive final assistant message after the last tool use

Action:

- Send `Please continue` to the same non-overseer session if idle and not already nudged for that process.

### Unacknowledged Non-Overseer Completion

Candidate:

- Latest non-overseer coding-agent process is completed.
- The completion is newer than the latest overseer coding-agent process or latest overseer assistant action that appears to coordinate the next step.
- At least 1 minute elapsed since the non-overseer completion.
- No newer teammate/overseer process indicates review routing, next milestone routing, or terminal `DONE`.

Action:

- Send overseer base-case prompt with response semantics.

Initial implementation can use conservative timestamp ordering:

- If the overseer has any coding-agent process created after the non-overseer completion, treat the completion as acknowledged.
- Otherwise, after 1 minute, prompt overseer.

This may be conservative but avoids guessing transcript semantics in v1.

### Callback Awareness

Evidence:

- transcript entry includes `vibe-agent callback`
- process result/log includes a callback completion marker
- callback process/hook event appears in logs

Rules:

- Do not nudge merely because the original agent turn ended after scheduling a callback.
- Once the callback completes, expect a follow-up within 1 minute.
- If no follow-up happens, route as:
  - direct `Please continue` when the same non-overseer session needs to resume
  - overseer base-case prompt when a non-overseer completion/result needs orchestration

## Overseer Base-Case Prompt

Exact configured text:

```text
- If all milestones are complete, stop and say "DONE" as your full response
- If you have just completed a milestone, make sure it gets reviewed by the appropriate agents.
- If you approve the review, continue to the next milestone.

Make sure to use vibe-agent send --respond ... to communicate with teammates
```

Response handling:

- If trimmed response is exactly `DONE`, mark workspace complete in state.
- Otherwise, keep monitoring.

## Codex Rate / Usage / Overuse Handling

Do not use Claude Code text matching for Codex behavior.

Observed Claude Code evidence:

- `error: "rate_limit"`
- text/result like `You've hit your limit · resets 4am (UTC)`

Observed Codex evidence from local VK SQLite:

- `account/rateLimits/updated`
- `rateLimits.limitId === "codex"`
- `rateLimits.primary.usedPercent`
- `rateLimits.primary.windowDurationMins`
- `rateLimits.primary.resetsAt`
- `rateLimits.secondary.usedPercent`
- `rateLimits.secondary.windowDurationMins`
- `rateLimits.secondary.resetsAt`
- token count events with `info.rate_limits.limit_id === "codex"`

Implementation approach:

1. Parse transcript/log JSON events when available.
2. Detect structured Codex rate/usage telemetry and actual structured errors first.
3. If an event clearly represents exhaustion/overuse, alert Discord once.
4. Do not implement broad phrase matching such as “model is being used too much” until real Codex evidence is found and converted into fixtures/tests.

Potential structured exhaustion signals to support if present:

- explicit error/status field indicating rate limit or usage exhaustion
- HTTP-like status `429`
- Codex `rateLimits` telemetry at or above 100% used
- service unavailable / overloaded structured event if emitted by Codex

Discord alert:

- Must include workspace URL: `${VK_ORIGIN}/workspaces/${workspaceId}`
- Should avoid session/process IDs unless later requested.
- Must not include transcript excerpt.
- Must not include or log webhook URL.
- One alert per deterministic event ID.

## Test Plan

Use TDD. Add failing tests before implementation where practical.

### Unit Tests

Add tests for:

- config parsing/validation
  - valid config
  - missing config
  - empty workspaces
  - duplicate workspace IDs
  - Discord URL in JSON rejected/ignored
  - `VK_ORIGIN` required
- state read/write and dedupe
  - missing/corrupt state recovers safely
  - nudged process not nudged twice
  - Discord event not alerted twice
  - workspace marked complete after exact `DONE`
- routing
  - non-overseer terminal no-final-response gets `Please continue`
  - running session is not messaged
  - teammate nudge does not request response
  - overseer unacknowledged completion after 1 minute sends base-case prompt
  - overseer completion acknowledged before 1 minute does not send
  - overseer response exact `DONE` marks complete
  - non-exact done text does not mark complete
- callback
  - callback scheduled but pending does not nudge
  - callback completed with no follow-up routes after 1 minute
- Codex rate/usage
  - Codex `account/rateLimits/updated` at exhaustion alerts once
  - Codex non-exhausted telemetry does not alert
  - structured rate-limit error alerts once
  - Claude Code text alone is not used as Codex detection
  - no transcript excerpt in Discord payload
  - workspace URL included in Discord payload

### Integration / Smoke Tests

- Build the vibe-agent CLI bundle.
- Run the monitor in `--once --dry-run` mode against a fixture config.
- Run existing nudge tests to ensure no regression:
  - `npm run check-types:vibe-agent`
  - targeted Vitest for `scripts/vibe-agent/nudge/*.test.ts`

Because this is TypeScript in the repo, also run:

```bash
npm run check-types
```

## Implementation Slices

### Slice 1: Config + State + CLI Shell

- Add parser and validation.
- Add `--once` and `--dry-run`.
- Add state handling.
- Add tests.

### Slice 2: Routing Decisions

- Extract pure decision functions.
- Reuse existing criteria helpers.
- Add tests for direct `Please continue` and overseer base-case decisions.

### Slice 3: Send/Respond Integration

- Add client abstraction for:
  - fire-and-forget teammate send
  - overseer request/response send
- If current `VibeClient` lacks response semantics, add a minimal extension around the underlying API used by `vibe-agent send --respond`, or import the source helper if already present.
- Add tests with fake client.

### Slice 4: Callback Awareness

- Add transcript/log parser helpers for callback scheduling/completion.
- Add callback decision tests.

### Slice 5: Codex Rate/Usage + Discord

- Add structured Codex event parser.
- Add Discord client helper that never logs webhook.
- Add event-level dedupe.
- Add tests.

### Slice 6: Packaging / Supervisor Wiring

- Add Vite build entry if needed.
- Consider whether to replace, extend, or run alongside existing `vibe-agent-nudge-daemon` supervisor program.
- Keep opt-in initially.

## Risks and Mitigations

- **False nudges while session is running**
  - Always check latest process status before sending.
- **Alert storms**
  - Deterministic event IDs and persisted alert dedupe.
- **Secret leakage**
  - Webhook env only; never log env value; tests should assert payload only.
- **Incorrect Codex phrase matching**
  - Prefer structured events; avoid broad guessed strings.
- **Overseer prompt loops**
  - Persist overseer prompt trigger IDs and do not repeat for the same completion/callback event.
- **Ambiguous acknowledgement**
  - Start with conservative timestamp ordering: any newer overseer coding-agent process acknowledges prior non-overseer completion.

## Open Follow-Up Items

These should not block the first implementation if tests encode current decisions:

- Find a real Codex exhausted-turn fixture if/when available.
- Decide whether state should prune old IDs after N days.
- Decide whether completed `DONE` workspaces should stay ignored forever or until config/state reset.
- Decide whether Discord alert should mention workspace name if available, in addition to URL.
