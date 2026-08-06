# Test Plan 1: VK mocked-provider sandbox through VD UI

Branch: `vk/3237-vd-mocked-model`

## Goal

Verify that a developer can run the local VD + VK mocked sandbox, use VD UI to create/open a VK craft backed by VK `qa-mode`, send a follow-up message from the VD Agent iframe, and capture a final screenshot without using real model-provider tokens.

## Result reporting

Create a new bead for each testing session. Add one comment/note containing JSON results using the test-case IDs below:

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

Include exact commands, URLs, screenshot paths, and any blocker notes either in the JSON `notes` fields or in a separate bead note.

## Preconditions

- VD repo is checked out at this branch.
- VK repo exists as sibling `../Vktest`.
- Node/pnpm dependencies are installed for VD and VK.
- VK Rust dependencies are installed.
- Caddy is installed and available on `PATH`.
- VK `qa-mode` backend has either already been built, or the tester accepts the initial Rust compile time.
- Before executing this plan, the sandbox should use the real committed Caddy config/template rather than hardcoded inline Caddyfile rendering in `scripts/vk-mocked-sandbox.ts`.

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

VK dev sqlite/config currently lives under the worktree-local `../Vktest/dev_assets`. If strict VK freshness is required for the session, use a throwaway VK worktree or clear/replace the relevant untracked dev assets according to the current sandbox implementation. Do **not** delete tracked files.

VD browser state can be reset by using a fresh `agent-browser --session` name, or by clearing browser local/session storage before opening VD.

## Test cases

### TEST_CASE_1A — Start sandbox

Steps:

1. From the VD repo, run:
   ```bash
   npm run dev:vk-mocked-sandbox
   ```
2. Record the printed:
   - VD URL
   - VK local-web URL
   - run dir
3. Wait until all services report ready:
   - VK backend qa-mode process is running.
   - VK local-web Vite server is ready.
   - VD Vite server is ready.
   - Caddy is serving the front-door URL.

Expected:

- Command stays running in foreground.
- No child process exits unexpectedly.
- VD URL is reachable.
- VK local-web URL is reachable.

### TEST_CASE_1B — Verify routing/health

Steps:

1. Open the printed VD URL in a browser or with `agent-browser`.
2. Verify the VD app loads without a blank page.
3. If using Caddy, verify VD browser requests can route `/vk-api/*` to VK.

Expected:

- VD UI renders.
- No fatal browser console errors that block the flow.
- No sandbox child process exits.

### TEST_CASE_2A — Open VD and name voyage

Steps:

1. Open the printed VD URL.
2. If onboarding asks for a voyage name, enter a unique name, for example:
   `Mocked Sandbox Test <date/time>`
3. Submit the voyage name.

Expected:

- VD workspace shell appears.
- Sidebar/voyage bar is visible.
- The named voyage is visible in VD.

### TEST_CASE_3A — Create or open VK workspace-creation view from VD

Steps:

1. Prefer the VD `New Craft` button if it opens the VK workspace creation UI.
2. If `New Craft` is still broken, use VD UI fallback:
   - Open sidebar.
   - Click `+ View`.
   - Choose `Custom URL`.
   - Title: `VK Create Craft Test`.
   - URL: the printed VK local-web URL with `/workspaces`, for example `http://localhost:<vkFrontendPort>/workspaces`.
   - Add the view.

Expected:

- A VD iframe/view opens VK workspace creation UI.
- The iframe is not blank.
- The iframe does not route VK frontend assets through VD routes incorrectly.

### TEST_CASE_4A — Create/select repository in VK UI

Steps:

1. In the VK iframe, create or select a test repository.
2. If creating a repository, use a sandbox path under `.vk-mocked-sandbox/repos` or another disposable directory.
3. Continue to the workspace prompt screen.

Expected:

- Repository is created or selected.
- The workspace prompt screen appears.
- No real provider credentials are required.

### TEST_CASE_5A — Create craft/workspace with qa-mode prompt

Steps:

1. In the VK prompt UI, enter a unique first line, for example:
   `VD Acceptance Craft <date/time>`
2. Add a prompt body indicating no-token mocked-provider acceptance, for example:
   `Use the qa-mode mocked provider to add a short acceptance note file proving this craft was created from VD UI.`
3. Submit/create.
4. Wait for VK qa-mode execution to complete.

Expected:

- The VK agent view shows model/system text indicating `qa-mock` or equivalent qa-mode behavior.
- Execution completes successfully.
- The UI shows mocked file changes and no real model-token usage.

### TEST_CASE_6A — Open created craft from VD UI

Steps:

1. Return to VD sidebar/voyage controls.
2. Click `Open Craft`.
3. Search/select the workspace whose title begins with the unique first line from `TEST_CASE_5A`.
4. Open it.

Expected:

- VD adds/selects a craft tab for the created VK workspace.
- The Agent iframe loads through the VK local-web origin when configured.
- Agent, Code, Beads, and Forms tabs are present as appropriate.

### TEST_CASE_7A — Send follow-up from VD Agent iframe

Steps:

1. In the VD Agent iframe for the created craft, type a follow-up such as:
   `Follow-up acceptance from VD UI: confirm the mocked qa-mode follow-up path runs without real model tokens.`
2. Send the follow-up.
3. Wait for qa-mode follow-up execution to complete.

Expected:

- Follow-up is accepted from inside VD.
- VK qa-mode runs the follow-up without real provider tokens.
- UI shows completed mocked execution and updated file-change count or mocked output.

### TEST_CASE_8A — Capture final screenshot

Steps:

1. Capture a screenshot of the final VD Agent iframe state.
2. Record screenshot path in the tester bead result.
3. Record final VD URL.

Expected:

- Screenshot visibly shows:
  - VD shell/chrome.
  - The created craft selected.
  - Agent iframe content.
  - Completed qa-mode output.
  - The follow-up prompt or follow-up result.

### TEST_CASE_9A — Stop sandbox cleanly

Steps:

1. Stop the foreground `npm run dev:vk-mocked-sandbox` process with Ctrl-C.
2. Check for leftover sandbox child processes.

Expected:

- Caddy, VD Vite, VK local-web, and VK backend child processes stop.
- No leftover `vk-mocked-sandbox`, sandbox Caddy, qa-mode backend, or sandbox Vite processes remain.

## Example passing result

```json
{
  "TEST_CASE_1A": {
    "status": "PASS",
    "notes": "Started with npm run dev:vk-mocked-sandbox. VD URL http://localhost:50005, VK URL http://localhost:50001."
  },
  "TEST_CASE_1B": { "status": "PASS" },
  "TEST_CASE_2A": { "status": "PASS" },
  "TEST_CASE_3A": {
    "status": "PASS",
    "notes": "Used + View fallback with VK local-web /workspaces URL."
  },
  "TEST_CASE_4A": { "status": "PASS" },
  "TEST_CASE_5A": { "status": "PASS" },
  "TEST_CASE_6A": { "status": "PASS" },
  "TEST_CASE_7A": { "status": "PASS" },
  "TEST_CASE_8A": {
    "status": "PASS",
    "notes": "Screenshot: /tmp/vd_accept_followup_sent.png"
  },
  "TEST_CASE_9A": { "status": "PASS" }
}
```
