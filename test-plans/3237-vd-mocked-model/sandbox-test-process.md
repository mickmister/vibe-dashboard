# VK mocked sandbox testing process

Branch: `vk/3237-vd-mocked-model`

## Purpose

This document describes the reusable testing process for VD + VK mocked sandbox
runs. Individual acceptance scenarios should live in separate `test-plan-*.md`
files in this directory and reference this process.

## Bead workflow

1. The canonical test-plan bead references the markdown test plan.
2. Each tester creates a new bead for their own testing session.
3. The tester records results on that session bead as one JSON note/comment
   keyed by test-case ID.

Example result note:

```json
{
  "TEST_CASE_1A": { "status": "PASS" },
  "TEST_CASE_2A": {
    "status": "FAIL",
    "notes": "Wasn't able to do x"
  }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

Include exact commands, URLs, screenshot paths, and any blocker notes either in
the JSON `notes` fields or in a separate bead note.

## Preconditions

- VD repo is checked out at this branch.
- VK repo exists as sibling `../Vktest`.
- Node/pnpm dependencies are installed for VD and VK.
- VK Rust dependencies are installed.
- Caddy is installed and available on `PATH`.
- VK `qa-mode` backend has either already been built, or the tester accepts the
  initial Rust compile time.
- Before executing sandbox acceptance plans, the sandbox should use the real
  committed Caddy config/template rather than hardcoded inline Caddyfile
  rendering in `scripts/vk-mocked-sandbox.ts`.

Recommended prebuild to avoid first-run Rust compile delay:

```bash
cd ../Vktest
cargo build --features qa-mode --bin server
```

## Fresh data guidance

For a fully fresh manual run, clear sandbox-local state before starting:

```bash
rm -rf .vk-mocked-sandbox/current
```

VK dev sqlite/config currently lives under the worktree-local
`../Vktest/dev_assets`. If strict VK freshness is required for the session, use
a throwaway VK worktree or clear/replace the relevant untracked dev assets
according to the current sandbox implementation. Do **not** delete tracked
files.

VD browser state can be reset by using a fresh `agent-browser --session` name,
or by clearing browser local/session storage before opening VD.

## Starting the sandbox

From the VD repo:

```bash
npm run dev:vk-mocked-sandbox
```

Record the printed:

- VD URL
- VK local-web URL
- run dir

Wait until all services report ready:

- VK backend qa-mode process is running.
- VK local-web Vite server is ready.
- VD Vite server is ready.
- Caddy is serving the front-door URL.

The command should stay running in the foreground. If any child process exits
unexpectedly, the sandbox should stop and report a failure.

## Stopping the sandbox

Stop the foreground `npm run dev:vk-mocked-sandbox` process with Ctrl-C.

After stopping, check that no leftover sandbox child processes remain:

```bash
pgrep -af 'vk-mocked-sandbox|cargo run --features qa-mode|pnpm --filter @vibe/local-web|caddy run --config .*vk-mocked-sandbox'
```

Expected:

- Caddy, VD Vite, VK local-web, and VK backend child processes stop.
- No leftover `vk-mocked-sandbox`, sandbox Caddy, qa-mode backend, or sandbox
  Vite processes remain.
