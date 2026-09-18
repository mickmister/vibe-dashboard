# PreviewServer / Preview URLs VD tester spec

Branch: `feature/encoded-preview-hosts`

Onboarding source:

- [`../../onboarding/overseer-intro.md`](../../onboarding/overseer-intro.md)
- [`../../onboarding/feature-work-process.md`](../../onboarding/feature-work-process.md)
- [`../../onboarding/independent-tester-prompt.md`](../../onboarding/independent-tester-prompt.md)
- [`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md)

## Scope

Validate the VD-side PreviewServer experience without using the Worker path.
This plan intentionally replaces the normal mocked-sandbox startup with the
global `vk dev-server` command. `vk dev-server` should run VD against the
already-running VK server for this environment.

Do **not** use:

```bash
npm run dev:vk-mocked-sandbox
npm run dev:vk-mocked-sandbox:ci-release
```

unless the overseer explicitly revises this plan.

## User stories

1. As a VD user, I can click the `PreviewServer` craft tab and the main content
   pane changes to the PreviewServer panel instead of only changing the URL.
2. As a VD user, I can create or view stored run configs and preview slots in
   the PreviewServer panel.
3. As an agent, I can use `vk preview-url ...` CLI commands to list, create,
   start, inspect logs for, stop, and generate canonical URLs for preview slots.
4. As a developer testing locally, I can start a simple stored preview process,
   see idempotent start behavior, and open a local Preview URL without involving
   the Cloudflare Worker path.

## Required environment

- Current repo checkout is on the target branch.
- VK server is already running separately.
- Global `vk` command is available on `PATH`.
- VD is started with global `vk dev-server`.
- Browser testing uses the repo-pinned Playwright CLI wrapper:

  ```bash
  PW_SESSION="previewserver-vd-$(date +%Y%m%d%H%M%S)"
  pnpm playwright:cli -s="$PW_SESSION" open "$VD_URL"
  pnpm playwright:cli -s="$PW_SESSION" snapshot --json
  ```

Record in the tester bead:

- exact VD branch/commit
- exact VK branch/commit if available
- `vk dev-server` command output
- printed VD URL
- Playwright CLI session name
- screenshots/transcripts/artifacts
- all `TEST_CASE_*` results as JSON

## Setup

### SETUP_A — Start VD through global `vk dev-server`

Steps:

1. From the VD checkout root, run:

   ```bash
   vk dev-server
   ```

2. Keep the process running.
3. Record the printed VD URL as `VD_URL`.
4. Open `VD_URL` in a browser or Playwright CLI.

Expected:

- VD starts successfully.
- VD uses the already-running VK server.
- No `dev:vk-mocked-sandbox` process is started.
- The VD app shell loads from `VD_URL`.

### SETUP_B — Identify a usable workspace and repo

Steps:

1. Open VD and select an existing Voyage/Craft backed by a VK workspace, or use
   the current workspace already prepared for this branch.
2. Record:
   - `WORKSPACE_ID`
   - `REPO_ID`
   - a private/local customer slug to use for URL generation, e.g. `preview`.
3. If `WORKSPACE_ID` or `REPO_ID` is not visible in the UI, use already
   documented environment/session details from the running VK/VD setup. Do not
   edit sqlite DBs manually for this test.

Expected:

- Tester has a real `WORKSPACE_ID` and `REPO_ID` for the remaining cases.
- If either ID cannot be obtained, mark setup as `BLOCKED` and include where
  the app got stuck.

## TEST_CASE_1A — PreviewServer tab swaps the active content pane

Purpose: cover the reported issue where clicking `PreviewServer` only changed
`views=previewserver-configs` and closed the bar without changing the frame.

Steps:

1. Open `VD_URL`.
2. Open the sidebar or top Voyage/Craft view bar where craft views are listed.
3. Start from a non-PreviewServer view such as `Agent` or `Code`.
4. Click the `PreviewServer` view/tab.
5. Take a fresh Playwright CLI snapshot.
6. Inspect the URL query string.
7. Inspect the main content pane.

Expected:

- URL includes a `views` token for PreviewServer, such as
  `views=previewserver-configs`.
- The main content pane changes immediately to the PreviewServer panel.
- The panel heading `PreviewServer` is visible.
- The panel description `stored run configs, preview slots, and canonical
  Preview URLs` is visible.
- The prior `Agent`/`Code` iframe is not the visible active content.
- The sidebar/bar may close, but closing the bar must not prevent the content
  pane from switching.

Error cases:

- If URL changes but the visible content does not, record `FAIL`.
- If the panel appears only after a full page reload, record `FAIL`.
- If the URL changes to `views=previewserver-configs` and then immediately
  canonicalizes back to the previous view, record `FAIL`.

## TEST_CASE_1B — PreviewServer tab stays selected across reload

Steps:

1. With `PreviewServer` visible from `TEST_CASE_1A`, reload the browser page.
2. Wait for the app shell to finish loading.
3. Take a fresh snapshot.

Expected:

- URL still resolves to the PreviewServer view.
- `PreviewServer` panel is visible after reload.
- No first-run Voyage prompt or unrelated modal appears.
- No blank iframe covers the panel.

## TEST_CASE_1C — PreviewServer works in split/pair layouts

Steps:

1. In a desktop viewport, create or select a split view containing
   `PreviewServer` and another view such as `Code`.
2. Take a snapshot.
3. Interact with the non-PreviewServer iframe enough to prove it remains in its
   pane.
4. Interact with the PreviewServer panel enough to prove it is clickable.

Expected:

- PreviewServer renders in its split pane.
- The other iframe remains positioned in the correct split pane.
- Both panes are visible and neither pane overlays the other incorrectly.

## TEST_CASE_2A — PreviewServer panel empty/loading/error states

Steps:

1. Open the `PreviewServer` panel.
2. Observe initial loading and final state.
3. If the workspace has no run configs or preview slots, inspect the empty
   states.

Expected:

- Loading resolves without an infinite spinner.
- Errors, if any, are shown inside the panel as readable text.
- Empty state says `No preview slots yet.` and/or `No run configs yet.`
- The UI does not crash if there are no existing configs.

## TEST_CASE_2B — Create a stored run config through VD UI

Preconditions:

- `WORKSPACE_ID` and `REPO_ID` are known.
- Use a unique suffix such as `$(date +%H%M%S)` for slugs/names.

Steps:

1. Open the `PreviewServer` panel.
2. In `Create stored run config`, fill:
   - `Repo ID`: `REPO_ID`
   - `Slug`: `web<unique-short-suffix>` or another lowercase/dashless slug
   - `Name`: `Preview Web <unique-suffix>`
   - `Kind`: `Long running`
   - `Command`:

     ```bash
     node -e "const http=require('http'); const port=Number(process.env.PORT); http.createServer((req,res)=>{res.setHeader('content-type','text/plain'); res.end('preview-ok '+(process.env.VK_WORKSPACE_ID||''));}).listen(port,'127.0.0.1')"
     ```

3. Click `Save run config`.
4. Refresh the panel if it does not refresh automatically.

Expected:

- Info notice says `Saved run config <slug>`.
- New run config appears under `Run configs`.
- Command text is visible in the row.
- No start-time arbitrary command payload is exposed; later start actions refer
  to the stored config.

Error cases:

- Try an empty `Repo ID` or empty `Command`.
- Expected: backend/UI rejects it with a readable error and no broken row is
  added.

## TEST_CASE_2C — Create a preview slot through VD UI

Preconditions:

- `TEST_CASE_2B` created a run config or one already exists.

Steps:

1. In `Create preview slot`, fill:
   - `Repo ID`: `REPO_ID`
   - `Run config`: the run config from `TEST_CASE_2B`
   - `Slot slug`: `web` or a unique lowercase/dashless slot slug up to 10 chars
   - `Title`: `Web`
2. Click `Save preview slot`.

Expected:

- Info notice says `Saved preview slot <slot>`.
- New slot appears under `Preview slots`.
- Row shows title, slot slug, repo id, and run config id.
- Row has `Start` and `Open URL` controls.

Error cases:

- Use a slot slug with invalid characters or excessive length if practical.
- Expected: backend/UI rejects it with a readable error.

## TEST_CASE_2D — Start slot and open local Preview URL from VD UI

Preconditions:

- `TEST_CASE_2C` has a preview slot.

Steps:

1. In the PreviewServer panel, set `Customer slug` to `preview`.
2. Click `Start` on the preview slot.
3. Observe status/message.
4. Click `Open URL`.
5. Inspect the newly opened tab/window.

Expected:

- Starting the slot does not create duplicate processes on repeated clicks.
- The panel shows a success message such as `Started preview slot`.
- `Open URL` opens a named Preview URL or reports the generated URL in the info
  notice.
- The preview page eventually renders `preview-ok`.
- If the process is still booting, a loading/starting state appears rather than
  an immediate broken frame.

Error cases:

- Click `Start` twice quickly.
- Expected: one active process is reused/idempotent; no duplicate process storm.

## TEST_CASE_3A — CLI lists PreviewServer configs

Steps:

1. Run:

   ```bash
   vk preview-url list "$WORKSPACE_ID" --json
   ```

2. Save stdout to the tester artifact directory.

Expected:

- Command exits 0.
- JSON includes `run_configs` and `preview_slots`.
- Objects created through the VD UI appear in the JSON.

## TEST_CASE_3B — CLI creates and starts stored configs

Steps:

1. Create a second run config through CLI:

   ```bash
   vk preview-url upsert-run-config "$WORKSPACE_ID" \
     --repo "$REPO_ID" \
     --slug "cliweb" \
     --name "CLI Web" \
     --command "node -e \"const http=require('http'); const port=Number(process.env.PORT); http.createServer((req,res)=>res.end('cli-preview-ok')).listen(port,'127.0.0.1')\"" \
     --json
   ```

2. Record the returned run config id as `CLI_RUN_CONFIG_ID`.
3. Start it:

   ```bash
   vk preview-url start-run-config "$WORKSPACE_ID" "$CLI_RUN_CONFIG_ID" --json
   ```

Expected:

- Upsert exits 0 and returns a stored config id.
- Start exits 0.
- Start output includes status/process information and, when applicable, a port
  or upstream reference.
- No command payload is accepted at start time; start uses the stored id.

## TEST_CASE_3C — CLI creates slot, generates URL, starts, logs, stops

Steps:

1. Create a preview slot for `CLI_RUN_CONFIG_ID`:

   ```bash
   vk preview-url upsert-slot "$WORKSPACE_ID" \
     --repo "$REPO_ID" \
     --run-config "$CLI_RUN_CONFIG_ID" \
     --slot "cliweb" \
     --title "CLI Web" \
     --json
   ```

2. Record returned slot id as `CLI_PREVIEW_SLOT_ID`.
3. Generate a URL:

   ```bash
   vk preview-url url "$WORKSPACE_ID" "$CLI_PREVIEW_SLOT_ID" --customer preview --json
   ```

4. Start the slot:

   ```bash
   vk preview-url start-slot "$WORKSPACE_ID" "$CLI_PREVIEW_SLOT_ID" --json
   ```

5. Record returned process id as `PROCESS_ID`.
6. Fetch logs:

   ```bash
   vk preview-url logs "$PROCESS_ID" --json
   ```

7. Stop the process:

   ```bash
   vk preview-url stop "$PROCESS_ID"
   ```

Expected:

- URL output includes a user-facing URL.
- Start output includes process information.
- Logs command exits cleanly and returns raw log data or an empty-but-valid log
  response.
- Stop command exits 0.

Error cases:

- Run `vk preview-url url "$WORKSPACE_ID" missing-slot --customer preview`.
- Expected: command exits non-zero with a clear not-found/error message.

## TEST_CASE_4A — Mobile/constrained viewport PreviewServer navigation

Steps:

1. Resize Playwright/browser viewport to a mobile size, e.g. `390x844`.
2. Open the sidebar or mobile voyage/view selector.
3. Select `PreviewServer`.
4. Take a snapshot.

Expected:

- Mobile bar/sidebar closes as designed.
- Main content switches to PreviewServer.
- Panel is scrollable and usable.
- `Save run config`, `Save preview slot`, `Start`, and `Open URL` controls are
  not cut off.

## TEST_CASE_4B — Browser artifact and E2E-conversion transcript

Steps:

1. Produce a transcript artifact following
   [`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md).
2. Include commands, snapshots, generated locator hints, expected/actual
   results, and final screenshot path.

Expected:

- Transcript is saved under `/tmp/...`, not committed.
- Result comment on tester bead includes artifact paths.
- The transcript is detailed enough for an implementer to convert the manual
  flow into a polished Playwright E2E later.

## Result schema

Tester should record one JSON object keyed by test-case ID:

```json
{
  "SETUP_A": { "status": "PASS", "notes": "VD_URL=http://..." },
  "SETUP_B": {
    "status": "PASS",
    "notes": "WORKSPACE_ID=..., REPO_ID=..."
  },
  "TEST_CASE_1A": { "status": "PASS" },
  "TEST_CASE_1B": { "status": "PASS" },
  "TEST_CASE_1C": { "status": "PASS" },
  "TEST_CASE_2A": { "status": "PASS" },
  "TEST_CASE_2B": { "status": "PASS" },
  "TEST_CASE_2C": { "status": "PASS" },
  "TEST_CASE_2D": { "status": "PASS" },
  "TEST_CASE_3A": { "status": "PASS" },
  "TEST_CASE_3B": { "status": "PASS" },
  "TEST_CASE_3C": { "status": "PASS" },
  "TEST_CASE_4A": { "status": "PASS" },
  "TEST_CASE_4B": { "status": "PASS" }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

## Cleanup

1. Stop any started preview processes with `vk preview-url stop <process-id>`.
2. Stop `vk dev-server`.
3. Close Playwright CLI session/browser.
4. Leave generated Playwright CLI artifacts uncommitted.
5. Record any cleanup failures on the tester bead.
