# gc-session-vibe

VD-owned Go implementation of the Gas City exec-provider bridge for Vibe Kanban.

## What it contains

- `bridge/` — reusable headless GC↔VK bridge logic
- `cmd/gc-session-vibe/` — CLI entrypoint for Gas City exec-provider usage
- `scripts/gc-session-vibe` — convenience wrapper for local development

## Local usage from Gas City

VD container images build this package into `/usr/local/bin/gc-session-vibe`.
That binary is the preferred runtime entrypoint for generated Gas City config:

```bash
export GC_SESSION=exec:/usr/local/bin/gc-session-vibe
```

For source checkout development, point `GC_SESSION` at the wrapper script in
this repo. The wrapper uses the installed `gc-session-vibe` binary when present
and falls back to `go run` for local editing:

```bash
export GC_SESSION=exec:/path/to/vibe-kanban-vscode-web/packages/gc-session-vibe/scripts/gc-session-vibe
```

Or invoke the Go CLI directly while developing:

```bash
go run /path/to/vibe-kanban-vscode-web/packages/gc-session-vibe/cmd/gc-session-vibe start demo
```

## Example Gas City session config

VD-generated cities should prefer city-level session config over shell-only
setup when the city TOML is being materialized. `GC_SESSION` still wins when it
is set in the process environment, so the TOML form is the durable default and
the env var is the operator override:

```toml
[workspace]
name = "vd-gc-city"
provider = "codex"

[session]
provider = "exec:/usr/local/bin/gc-session-vibe"
startup_timeout = "2m"

[beads]
provider = "file"

[[rigs]]
name = "app"
path = "/workspace/app"

[[agent]]
name = "reviewer"
dir = "app"
provider = "codex"
work_dir = ".gc/worktrees/{{.Rig}}/reviewer/{{.AgentBase}}"
min_active_sessions = 0
max_active_sessions = 2
```

For local source checkouts, render the same `[session]` block with the wrapper
path instead:

```toml
[session]
provider = "exec:/path/to/vibe-kanban-vscode-web/packages/gc-session-vibe/scripts/gc-session-vibe"
```

VD should provide the bridge-specific settings as runtime environment for the
`gc` server/process that reads this city, not as Gas City provider TOML:

```bash
export VIBE_BASE_URL=http://127.0.0.1:3000
export VIBE_REPO_MATCH=/workspace/app
export VIBE_TARGET_BRANCH=main
export VIBE_EXECUTOR=codex
export VIBE_STATE_ROOT=/data/vibe-kanban/gc-session-vibe
```

### VK-first adoption config

When VD has already provisioned a VK workspace/session, keep the same
`[session] provider = "exec:..."` value and add adoption env for the GC operation
that should bind to that workspace:

```bash
export VIBE_ADOPT_WORKSPACE_ID=workspace_123
export VIBE_ADOPT_SESSION_ID=session_456
export VIBE_WORKING_DIR=/workspace/app
export VIBE_SESSION_LABEL="GC reviewer for app"
```

In this mode the bridge does not create a new VK workspace. It resolves the
existing workspace, requires its `container_ref`, points GC's workdir symlink at
that location, persists the VK IDs in bridge state, optionally renames the VK
session, and delivers the GC start nudge as a VK follow-up.

## Container/runtime ownership

This package is the active home for the GC↔VK exec-provider bridge used by VD.
Runtime images compile it from the VD repo and install it alongside the local
`gc` binary. Gas City checkouts should only need to reference the external
binary/script through `GC_SESSION`; new bridge behavior should be implemented
and tested here rather than in the `gascity` repo.

## Environment

The bridge currently uses the same env vars as the MVP donor implementation:

- `VIBE_BASE_URL`
- `VIBE_REPO_MATCH`
- `VIBE_TARGET_BRANCH`
- `VIBE_EXECUTOR`
- `VIBE_EXECUTOR_VARIANT`
- `VIBE_MODEL_ID`
- `VIBE_AGENT_ID`
- `VIBE_REASONING_ID`
- `VIBE_PERMISSION_POLICY`
- `VIBE_DELETE_WORKSPACE_ON_STOP`
- `VIBE_STATE_ROOT`
- `GC_EXEC_STATE_DIR`

## Adopt existing VK workspace/session

Set the adoption variables when GC should bind a session to a VK workspace and
session that VD already created, instead of asking the bridge to call
`/api/workspaces/start`:

- `VIBE_ADOPT_WORKSPACE_ID` — existing VK workspace ID to bind.
- `VIBE_ADOPT_SESSION_ID` — existing VK session/execution session ID to bind.
- `VIBE_WORKING_DIR` — optional repo/workdir hint for follow-up prompts.
- `VIBE_SESSION_LABEL` — optional human-readable VK session name to apply.

When `VIBE_ADOPT_WORKSPACE_ID` is present, the bridge:

1. loads the workspace from VK,
2. requires a non-empty `container_ref`,
3. points the GC workdir symlink at that workspace path,
4. persists the VK workspace/session IDs in bridge state,
5. optionally renames the VK session, and
6. sends the GC start nudge as a VK follow-up when one is provided.

This is the preferred path for VD New Workspace GC-backed modes because VD
creates/opens the VK workspace first and then layers GC orchestration on top.

## Behavior and verification coverage

The bridge persists one JSON state file per GC session under
`VIBE_STATE_ROOT`/`GC_EXEC_STATE_DIR`, plus normalized peek-log cache files. On
`start`, it refreshes the GC workdir symlink to the VK workspace path so GC
status and session metadata continue to point at the active VK-backed work area.
`stop` is idempotent and only deletes the VK workspace when
`VIBE_DELETE_WORKSPACE_ON_STOP=true`; otherwise it marks bridge state stopped and
leaves the VK workspace available for inspection.

Current Go smoke coverage lives in `bridge/bridge_test.go`:

- `TestHandleStartCreatesStateAndSymlink` covers repository lookup, VK
  workspace/session creation, state persistence, metadata, and symlink refresh.
- `TestHandleNudgeUpdatesExecutionAndListRunning` covers follow-up prompts and
  status/list-running behavior.
- `TestHandleInterruptStopsExecutionAndMarksKilled` covers interrupt routing and
  killed-state persistence.
- `TestHandlePeekHydratesNormalizedLogsAndTailsOutput` covers normalized log
  hydration, cache writes, and line-tail output.
- `TestHandleStartAdoptsExistingWorkspaceAndRenamesSession` covers VK-first
  adoption, label updates, follow-up nudge delivery, and symlink refresh.
- `TestHandleStopDeletesWorkspaceWhenConfigured` covers delete-on-stop cleanup
  and idempotent stop semantics.

Run the package tests from a Go-enabled environment with:

```bash
cd packages/gc-session-vibe
go test ./...
```

The VD container verification path additionally builds this package into
`/usr/local/bin/gc-session-vibe` and smoke-checks the installed binary with
`gc-session-vibe list-running`.
