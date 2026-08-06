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
- The sandbox uses the real checked-in `Caddyfile`.
- The sandbox builds VK `@vibe/local-web` before starting services, then serves
  VK frontend through the VK backend and Caddy. VK iframes should therefore use
  the printed VD/Caddy origin rather than a separate VK Vite origin.

Recommended prebuilds to avoid first-run compile/build delay:

```bash
cd ../Vktest
cargo build --features qa-mode --bin server
pnpm --filter @vibe/local-web run build
```

## Fresh data guidance

For a fully fresh manual run, clear sandbox-local state before starting:

```bash
rm -rf .vk-mocked-sandbox/current
rm -rf data
rm -rf ../Vktest/dev_assets
```

VK dev sqlite/config currently lives under the worktree-local
`../Vktest/dev_assets`. VD server-side state currently lives under the
worktree-local `data` directory. These directories are expected to be untracked
local development state. Do **not** delete tracked files.

VD browser state can be reset by using a fresh `agent-browser --session` name,
or by clearing browser local/session storage before opening VD.

## Starting the sandbox

From the VD repo:

```bash
npm run dev:vk-mocked-sandbox
```

Record the printed:

- VD URL
- VK frontend URL
- run dir

Wait until all services report ready:

- VK backend qa-mode process is running.
- VK local-web build setup command completes.
- VD Vite server is ready.
- Caddy is serving the front-door URL.

Expected same-origin shape:

- VD loads from the printed VD URL, for example `http://localhost:50005`.
- VK frontend iframes also load from that same origin, for example
  `http://localhost:50005/workspaces/...`.
- VD browser requests to `/vk-api/*` route through Caddy to VK backend `/api/*`.
- There is no separate VK Vite frontend server in the default sandbox.

The command should stay running in the foreground. If any child process exits
unexpectedly, the sandbox should stop and report a failure.

## Editing and reloading during development

The default sandbox optimizes for prod-like same-origin behavior rather than VK
frontend hot module replacement.

### VD source changes

VD runs through Vite dev mode. Edit VD source in this repo, then use Vite HMR or
reload the browser. Restart the sandbox for changes to the checked-in
`Caddyfile`, `scripts/vk-mocked-sandbox.ts`, env/port behavior, or server
startup behavior.

### VK frontend source changes

VK frontend is served from the built `@vibe/local-web` output through VK
backend/Caddy. After editing VK frontend source under `../Vktest`, rebuild and
reload the browser:

```bash
cd ../Vktest
pnpm --filter @vibe/local-web run build
```

This is usually much cheaper than a cold VK Rust/backend build. No Caddy restart
is expected for ordinary VK frontend source edits because the VK backend serves
the rebuilt static files from disk.

### VK backend source changes

After editing VK backend/Rust source under `../Vktest`, stop and restart the
sandbox:

```bash
npm run dev:vk-mocked-sandbox
```

Rust incremental rebuilds should be faster after the first successful build.

## Browser automation and iframes

All mutating acceptance-test actions should be performed through the VD UI. The
default sandbox serves VK iframes from the same Caddy origin as VD so
`agent-browser frame` can be attempted against the VD-hosted iframe rather than
opening a separate VK tab.

Recommended frame workflow:

```bash
agent-browser snapshot -i
agent-browser frame "iframe[title='Create Workspace']"
agent-browser snapshot -i
agent-browser frame main
```

Use fixed viewport dimensions before coordinate-sensitive steps. Record the
iframe `src`, final VD URL, and screenshot path in the tester bead result.

## Stopping the sandbox

Stop the foreground `npm run dev:vk-mocked-sandbox` process with Ctrl-C.

After stopping, check that no leftover sandbox child processes remain:

```bash
pgrep -af 'vk-mocked-sandbox|cargo run --features qa-mode|pnpm --filter @vibe/local-web|caddy run --config .*vk-mocked-sandbox'
```

Expected:

- Caddy, VD Vite, and VK backend child processes stop.
- No leftover `vk-mocked-sandbox`, sandbox Caddy, qa-mode backend, or sandbox
  Vite processes remain.
