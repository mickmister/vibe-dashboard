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
