# gc-session-vibe

VD-owned Go implementation of the Gas City exec-provider bridge for Vibe Kanban.

## What it contains

- `bridge/` — reusable headless GC↔VK bridge logic
- `cmd/gc-session-vibe/` — CLI entrypoint for Gas City exec-provider usage
- `scripts/gc-session-vibe` — convenience wrapper for local development

## Local usage from Gas City

Point `GC_SESSION` at the wrapper script in this repo:

```bash
export GC_SESSION=exec:/path/to/vibe-kanban-vscode-web/packages/gc-session-vibe/scripts/gc-session-vibe
```

Or invoke the Go CLI directly:

```bash
go run /path/to/vibe-kanban-vscode-web/packages/gc-session-vibe/cmd/gc-session-vibe start demo
```

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
