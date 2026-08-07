# VK mocked sandbox testing process

Branch: `vk/3237-vd-mocked-model`

## Purpose

This document describes the reusable testing process for VD + VK mocked sandbox
runs. Individual acceptance scenarios should live in separate `test-plan-*.md`
files in this directory and reference this process.

The sandbox is intended to exercise VD end-to-end against a real local VK
backend while VK runs in `qa-mode`. VK `qa-mode` uses a mocked model provider,
so normal craft creation and follow-up flows can be tested without real
model-provider tokens.

## Current shape

- One Caddy front door serves the whole sandbox.
- VD and VK iframes use the same browser origin, for example
  `http://localhost:50005`.
- VD runs in Vite dev mode behind Caddy.
- VK backend runs as `cargo run --features qa-mode --bin server`.
- VK frontend is built once before the services start, using Vite base
  `/vk-static/`, then served by the VK backend through Caddy.
- VK frontend assets load from `/vk-static/assets/...`; VD assets continue to
  use VD's normal `/assets/...` routing.
- Caddy uses the checked-in repo `Caddyfile`. The sandbox writes a prepared copy
  to `.vk-mocked-sandbox/current/Caddyfile` after selecting ports/env.

This setup intentionally prioritizes prod-like same-origin iframe behavior over
VK frontend hot module replacement.

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
- The sandbox builds VK `@vibe/local-web` before starting services with Vite
  base `/vk-static/`, then serves VK frontend through the VK backend and Caddy.
  VK iframes should therefore use the printed VD/Caddy origin rather than a
  separate VK Vite origin, and VK built assets should load from
  `/vk-static/assets/...` instead of competing with VD assets under `/assets`.

Optional prebuilds to reduce the first sandbox startup delay:

```bash
cd ../Vktest
cargo build --features qa-mode --bin server
NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @vibe/local-web run build --base /vk-static/
```

The first VK Rust build can be slow. Subsequent Rust starts usually reuse
incremental build artifacts. The VK frontend build is currently still performed
by `npm run dev:vk-mocked-sandbox` so that the served assets match the sandbox
base path.

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

VD browser state can be reset by using a fresh Playwright CLI `-s=<session>`
name, deleting Playwright CLI session data, or clearing browser local/session
storage before opening VD.

Create disposable repositories under `.vk-mocked-sandbox/repos` so cleanup stays
inside the VD worktree.

## Starting the sandbox

From the VD repo:

```bash
npm run dev:vk-mocked-sandbox
```

The script chooses open ports starting at `50000` and writes the selected values
to `.vk-mocked-sandbox/current/env.sh`. To preview the plan without starting the
servers, run:

```bash
npm run prepare:vk-mocked-sandbox
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
- VK frontend built assets load from that same origin under `/vk-static`.
- VD browser requests to `/vk-api/*` route through Caddy to VK backend `/api/*`.
- There is no separate VK Vite frontend server in the default sandbox.

The command should stay running in the foreground. If any child process exits
unexpectedly, the sandbox should stop and report a failure.

### Useful environment overrides

| Variable | Purpose |
| --- | --- |
| `VK_MOCKED_SANDBOX_PORT_START` | First candidate port for automatic allocation. |
| `VK_MOCKED_BACKEND_PORT` | Explicit VK backend port. |
| `VK_MOCKED_FRONTEND_PORT` | Allocated for compatibility with older plans; the default same-origin sandbox does not start a separate VK Vite frontend. |
| `VK_MOCKED_PREVIEW_PROXY_PORT` | Explicit VK preview/code proxy port. |
| `VK_MOCKED_VD_DASHBOARD_PORT` | Explicit VD Vite port. |
| `VK_MOCKED_VD_SERVER_PORT` | Explicit VD server port. |
| `VK_MOCKED_CADDY_PORT` | Explicit front-door Caddy port. |
| `RUST_LOG` | VK backend log level; defaults to `debug` in the sandbox. |

Explicit port overrides must be unique. The sandbox rejects duplicate explicit
ports instead of starting with ambiguous routing.

## Quick health checks

Use these checks after the sandbox reports ready:

```bash
# Caddy front door responds with VD.
curl -I "$VD_URL"

# VK workspace HTML comes through the same Caddy origin and references
# /vk-static assets.
curl -sS "$VD_URL/workspaces" | grep /vk-static/assets

# VK built JS is served by the VK backend through Caddy.
ASSET_PATH="$(curl -sS "$VD_URL/workspaces" | grep -o '/vk-static/assets/[^"]*\.js' | head -1)"
curl -I "$VD_URL$ASSET_PATH"
```

For browser-level verification, open VD with a fresh named session:

```bash
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox open "$VD_URL"
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox resize 1280 900
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox snapshot --json
```

## Editing and reloading during development

The default sandbox optimizes for prod-like same-origin behavior rather than VK
frontend hot module replacement.

### VD source changes: hot reload

VD runs through Vite dev mode. Edit VD source in this repo, then use Vite HMR or
reload the browser. Restart the sandbox for changes to the checked-in
`Caddyfile`, `scripts/vk-mocked-sandbox.ts`, env/port behavior, or server
startup behavior.

### VK frontend source changes: rebuild and reload

VK frontend is served from the built `@vibe/local-web` output through VK
backend/Caddy. After editing VK frontend source under `../Vktest`, rebuild and
reload the browser:

```bash
cd ../Vktest
NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @vibe/local-web run build --base /vk-static/
```

This is usually much cheaper than a cold VK Rust/backend build. No Caddy restart
is expected for ordinary VK frontend source edits because the VK backend serves
the rebuilt static files from disk.

Main drawback: this is not a VK frontend HMR loop. The rebuild keeps iframe
origin behavior close to production, but it is slower than running VK local-web
directly with Vite.

### VK backend source changes: restart sandbox

After editing VK backend/Rust source under `../Vktest`, stop and restart the
sandbox:

```bash
npm run dev:vk-mocked-sandbox
```

Rust incremental rebuilds should be faster after the first successful build.

## Browser automation and iframes

All mutating acceptance-test actions should be performed through the VD UI. The
default sandbox serves VK iframes from the same Caddy origin as VD so tests can
inspect the VD-hosted iframe's `contentDocument` directly rather than opening a
separate VK tab.

Use Playwright CLI as the default agent-driven browser tool. The workflow is:

1. Open the printed VD URL with a fresh session.
2. Capture `snapshot --json`.
3. Interact using refs from the latest snapshot.
4. Capture a fresh snapshot after navigation, modal changes, iframe changes, or
   major re-renders.
5. Generate stable locator hints for important refs.
6. Record commands, URLs, snapshot paths, locator hints, screenshots, and
   observed results on the tester bead.

Example:

```bash
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox open "$VD_URL"
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox snapshot --json
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox click e<N> --json
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox generate-locator e<N> --json
```

Refs such as `e<N>` are temporary exploration handles. They must not be copied
into committed E2E tests.

Recommended same-origin iframe inspection workflow:

```bash
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox snapshot --json
PLAYWRIGHT_MCP_SANDBOX=false npx -y @playwright/cli@latest -s=vk-mocked-sandbox eval "(() => {
  const frame = document.querySelector('iframe[title=\"Create Workspace\"]');
  return {
    src: frame?.src,
    text: frame?.contentDocument?.body?.innerText?.slice(0, 1000),
    scripts: [...(frame?.contentDocument?.scripts ?? [])].map((s) => s.src),
  };
})()"
```

Prefer semantic refs and generated locator hints. For same-origin iframes,
prefer Playwright E2E `frameLocator(...)` in the final test. Use fixed viewport
dimensions before coordinate-sensitive steps. If a manual acceptance pass must
fall back to coordinates, calculate visible control positions from the
same-origin iframe DOM and click those coordinates from the VD page. Record the
iframe `src`, final VD URL, and screenshot path in the tester bead result.

Known fallback: if Playwright CLI cannot operate a same-origin VK iframe
semantically during an exploratory pass, same-origin DOM access should still
work through `iframe.contentDocument`. The accepted fallback is:

1. Use Playwright CLI `eval` to inspect iframe text, scripts, and element
   positions from the VD page.
2. Use visible coordinate clicks from the VD page for controls inside the
   iframe.
3. Continue to record the iframe `src` and screenshots as evidence.

This workaround is reasonable for acceptance smoke testing, but semantic
iframe-scoped clicks would be preferable for a larger automated suite.

## Creating the E2E test from the browser pass

When this sandbox plan exposes behavior that should remain covered, create a
Playwright E2E test from the completed Playwright CLI session.

1. Save a transcript artifact outside tracked source, for example under
   `/tmp` or another ignored scratch directory. Include:
   - the exact Playwright CLI commands
   - each snapshot path
   - each ref used for exploration
   - the generated locator hint for important refs
   - assertions observed in the UI
   - screenshot paths and final URLs
2. Convert the transcript into a draft spec under `tests/e2e`.
3. Polish before committing:
   - import from `playwright/test`
   - replace refs with semantic locators
   - use `frameLocator(...)` for VK iframe interactions when possible
   - use `expect` web-first assertions for visible outcomes
   - avoid direct API mutation and separate VK tabs for mutating actions
4. Run the focused E2E test:

   ```bash
   npx playwright test tests/e2e/<spec-name>.spec.ts --trace on
   ```

5. Run required repo checks, including `npm run check-types` when source or test
   TypeScript changes are made.

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
