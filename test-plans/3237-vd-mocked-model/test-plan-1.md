# Test Plan 1: VK mocked-provider sandbox through VD UI

Branch: `vk/3237-vd-mocked-model`

Process reference: [`sandbox-test-process.md`](./sandbox-test-process.md)

## Goal

Verify that a developer can run the local VD + VK mocked sandbox, use VD UI to
create/open a VK craft backed by VK `qa-mode`, send a follow-up message from the
VD Agent iframe, and capture a final screenshot without using real
model-provider tokens.

## Test cases

### TEST_CASE_1A — Start sandbox

Steps:

1. Follow `Starting the sandbox` in
   [`sandbox-test-process.md`](./sandbox-test-process.md).

Expected:

- Command stays running in foreground.
- No child process exits unexpectedly.
- VD URL is reachable.
- VK local-web URL is reachable.

### TEST_CASE_1B — Verify routing/health

Steps:

1. Open the printed VD URL with `agent-browser`.
2. Wait for the VD app shell to render.
3. Verify the top voyage bar is visible across the top of the page.
4. Verify the left sidebar is visible. The sidebar top section contains:
   - `New Craft`
   - `Open Craft`
   - `+ Craft`
   - `+ View`
   - `+ Pair`
5. Verify VD browser requests can route `/vk-api/*` to VK through Caddy.

Expected:

- VD UI renders.
- No fatal browser console errors that block the flow.
- No sandbox child process exits.

### TEST_CASE_2A — Open VD and name voyage

Steps:

1. Open the printed VD URL.
2. The onboarding screen displays the heading
   `Name the Voyage for this workspace.`
3. In the `Voyage name` textbox, enter a unique name, for example:
   `Mocked Sandbox Test <date/time>`
4. Click the `Create Voyage` button.

Expected:

- VD workspace shell appears.
- Sidebar/voyage bar is visible.
- The named voyage is visible in VD.

### TEST_CASE_3A — Open VK workspace-creation UI from VD New Craft

Steps:

1. Locate the left sidebar.
2. In the sidebar top action section, click the full-width `New Craft` button.
3. Wait for the main content area to show the VK workspace creation iframe.
4. Verify the VK iframe shows the heading
   `Which repositories would you like to work on?`
5. Verify the VK iframe shows the repository-source buttons:
   - `Recent`
   - `Browse`
   - `Create`

Expected:

- The VD `New Craft` button opens VK workspace creation UI directly.
- The iframe is not blank.
- The iframe does not route VK frontend assets through VD routes incorrectly.

### TEST_CASE_4A — Create repository in VK UI

Steps:

1. In the VK iframe under the heading
   `Which repositories would you like to work on?`, click `Create`.
2. In the `Create New Repository` dialog, fill the repository-name textbox with
   a unique name, for example:
   `mocked-provider-test-<date-time>`
3. Fill the `Current directory` textbox with a disposable sandbox directory
   under the VD repo, for example:
   `.vk-mocked-sandbox/repos`
4. Click `Create Repository`.
5. The command bar opens for branch selection. Select the `main` branch entry.
6. Back on the repository selection screen, verify the selected repository chip
   appears.
7. Click `Continue`.

Expected:

- Repository is created and selected.
- The workspace prompt screen appears.
- No real provider credentials are required.

### TEST_CASE_5A — Create craft/workspace with qa-mode prompt

Steps:

1. The VK prompt screen displays the heading
   `What would you like to work on?`
2. In the large markdown editor under that heading, enter a unique first line,
   for example:
   `VD Acceptance Craft <date/time>`
3. Add a prompt body indicating no-token mocked-provider acceptance, for
   example:
   `Use the qa-mode mocked provider to add a short acceptance note file proving this craft was created from VD UI.`
4. Verify the executor dropdown near the top-left of the prompt card reads
   `Codex`.
5. Verify the repository selector row shows the repository created in
   `TEST_CASE_4A`.
6. Click the orange `Create` button on the right side of the prompt card.
7. Wait for VK qa-mode execution to complete.

Expected:

- The VK agent view shows model/system text indicating `qa-mock`.
- Execution completes successfully.
- The UI shows mocked file changes and no real model-token usage.

### TEST_CASE_6A — Open created craft from VD UI

Steps:

1. Open the VD left sidebar using the hamburger button in the top-left of the
   voyage bar.
2. In the sidebar top action section, click `Open Craft`.
3. In the `Open VK Workspace` dialog, locate the `Search workspaces...`
   textbox near the top of the dialog.
4. Type the unique first line from `TEST_CASE_5A`.
5. In the results list below the repository filter, click the workspace whose
   title begins with that unique first line.
6. Wait for VD to add/select the craft tab.

Expected:

- VD adds/selects a craft tab for the created VK workspace.
- The `Agent` view is selected in the main content area.
- The craft sidebar entry lists the built-in tabs:
  - `Agent`
  - `Code`
  - `Beads`
  - `Forms`

### TEST_CASE_7A — Send follow-up from VD Agent iframe

Steps:

1. In the selected VD craft, verify the main content area shows the `Agent`
   iframe.
2. Scroll to the bottom of the Agent iframe.
3. Locate the follow-up markdown editor with placeholder text
   `Continue working on this task...`
4. Type a follow-up such as:
   `Follow-up acceptance from VD UI: confirm the mocked qa-mode follow-up path runs without real model tokens.`
5. Click the `Send` button at the bottom-right of the Agent iframe composer.
6. Wait for qa-mode follow-up execution to complete.

Expected:

- Follow-up is accepted from inside VD.
- VK qa-mode runs the follow-up without real provider tokens.
- UI shows completed mocked execution and updated file-change count or mocked
  output.

### TEST_CASE_8A — Capture final screenshot

Steps:

1. Keep the VD craft selected in the top voyage bar.
2. Keep the `Agent` view selected for that craft.
3. Capture a screenshot of the final VD Agent iframe state.
4. Record screenshot path in the tester bead result.
5. Record final VD URL.

Expected:

- Screenshot visibly shows:
  - VD shell/chrome.
  - The created craft selected.
  - Agent iframe content.
  - Completed qa-mode output.
  - The submitted follow-up prompt.
  - The completed follow-up result.

### TEST_CASE_9A — Stop sandbox cleanly

Steps:

1. Follow `Stopping the sandbox` in
   [`sandbox-test-process.md`](./sandbox-test-process.md).

Expected:

- Caddy, VD Vite, VK local-web, and VK backend child processes stop.
- No leftover `vk-mocked-sandbox`, sandbox Caddy, qa-mode backend, or sandbox
  Vite processes remain.

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
    "notes": "Clicked VD New Craft and VK workspace creation UI opened."
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
