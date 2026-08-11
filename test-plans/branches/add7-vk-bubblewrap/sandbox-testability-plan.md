# VK agent sandbox testability plan

Branch: `vk/add7-vk-bubblewrap`

Use this plan after the qa-mode runtime probe and host-command trigger are reviewed. Do not launch the full independent tester pass before those triggers are present in the VK checkout used by the mocked sandbox.

## User story

VK users can enable agent sandboxing from the UI, keep their workspace writable, mark repo dependency paths read-only, choose whether network is available, and approve or deny host commands without the agent silently escaping the sandbox.

## Preconditions

- VD checkout includes the weekly dev mocked sandbox harness (`origin/vk/05a2-vd-weekly-dev-br`).
- VK checkout points at this sandbox feature branch.
- Use `test-plans/onboarding/vk-mocked-sandbox.md` for startup, fixture reset, Playwright CLI workflow, and cleanup.
- Use fixture variant `basic-seeded` for follow-up tests unless a test case explicitly says otherwise.
- The seeded repo contains `node_modules/.keep` so the UI default read-only repo path maps to a real directory.
- The prompt marker `VK_QA_SANDBOX_PROBE` runs the qa-mode filesystem/network probe inside the prepared sandboxed child process.
- The prompt marker `VK_QA_HOST_COMMAND` requests a first-class VK host-command approval with command/cwd/reason/result handling.
- The qa-mode log stream includes deterministic Claude-compatible read/write/bash `tool_use` and `tool_result` entries so mocked E2E/manual runs can verify tool-call rendering without real model tokens.

## Implementer validation before independent testing

Run these focused checks in the VK checkout:

```bash
cargo test -p executors --features qa-mode qa_mock -- --nocapture
cargo test -p executors sandbox -- --nocapture
cargo test -p services services::approvals::tests -- --nocapture
cargo check -p server --features qa-mode
pnpm run format
```

Run these focused checks in the VD checkout after merging weekly dev:

```bash
npm run check-types
npm run e2e:vk-mocked-sandbox:validate -- --variant basic-seeded
```

## Manual acceptance matrix

Record results as JSON keyed by these IDs.

### TEST_CASE_1A — Sandbox UI sends common DSL only

Steps:
1. Reset mocked sandbox to `basic-seeded` and start it.
2. Open the printed VD URL.
3. Open the seeded VK craft/workspace.
4. In the VK composer, open `Sandbox` settings.
5. Enable sandbox, leave network as `Allow network`, and keep `node_modules` in read-only repo paths.
6. Send a follow-up containing `VK_QA_SANDBOX_PROBE`.

Expected:
- The UI exposes no backend names such as bwrap or sandbox-exec.
- The completed qa-mode output includes deterministic mocked tool-call entries (read/write/bash) in addition to final assistant text.
- The agent turn starts without retrying unsandboxed.
- The executor action payload contains `sandbox.enabled=true`, `network=inherit`, and `readonly_repo_paths=["node_modules"]`.
- `qa_sandbox_probe_result.json` is created in the repo.
- `qa_sandbox_probe_workspace_write.txt` exists.
- No `node_modules/qa_sandbox_probe_readonly_write.txt` file exists.

### TEST_CASE_1B — Network disabled is enforced by the sandboxed child

Steps:
1. In the VK composer sandbox settings, set Network to `No network`.
2. Send a follow-up containing `VK_QA_SANDBOX_PROBE`.
3. Inspect `qa_sandbox_probe_result.json`.

Expected:
- `workspace_write` is `allowed`.
- `readonly_path_present` is `true`.
- `readonly_write` is `denied`.
- `network` is `denied_or_unreachable` or `probe_tool_unavailable`; it must not be `allowed`.

### TEST_CASE_2A — Host command approve flow runs on host after explicit approval

Steps:
1. Send a VK follow-up containing `VK_QA_HOST_COMMAND`.
2. Wait for the host-command approval UI.
3. Verify the approval card shows exact command, cwd, reason, timeout/output summary, and that it runs outside the agent sandbox.
4. Click Approve.

Expected:
- The command is not executed before approval.
- After approval, `qa_host_command_approved.txt` exists in the repo and contains `VK_QA_HOST_COMMAND_OK`.
- The approval result shows stdout containing `VK_QA_HOST_COMMAND_STDOUT`.
- The agent process completes after the approval result is available.

### TEST_CASE_2B — Host command deny flow does not run command

Steps:
1. Remove `qa_host_command_approved.txt` if it exists.
2. Send another follow-up containing `VK_QA_HOST_COMMAND`.
3. Deny the approval with a short reason.

Expected:
- `qa_host_command_approved.txt` is not created.
- The approval UI records the denial.
- The qa-mode process completes without running the command.

### TEST_CASE_3A — Platform acceptance

Steps:
1. Run TEST_CASE_1B on macOS using the local mocked sandbox.
2. Run TEST_CASE_1B on Linux using the Docker/mocked-sandbox path from `vk-mocked-sandbox.md` or the CI workflow.

Expected:
- macOS uses the automatic sandbox-exec backend internally and passes the probe expectations.
- Linux uses the automatic bwrap backend internally and passes the probe expectations.
- Explicit sandbox enable fails clearly if the backend is unavailable; it must not silently run unsandboxed.

## Independent tester launch prompt

After review approval, launch the tester with:

```text
Run an independent tester pass.

Use the tester onboarding file:
- test-plans/onboarding/independent-tester-prompt.md

Feature/test-plan bead:
- vibe-kanban-s73 — Decide VK sandbox E2E testing scope

Approved test-plan document(s):
- test-plans/branches/add7-vk-bubblewrap/sandbox-testability-plan.md
```
