# VD - VaultWarden Integration user-story and testing map

Workspace: [VD - VaultWarden Integration](https://jamtools.dev/workspaces/43fd5a18-1b44-4bea-974f-747b286de40b)

Branch under test: `vk/43fd-vd-vaultwarden-i`

Weekly-dev base: `vk/05a2-vd-weekly-dev-br`

CI PR: [#48 VD - VaultWarden Integration: Settings/Vardash workflow](https://github.com/mickmister/vibe-dashboard/pull/48)

Coordination bead: `vkvw-hzzg.5 — VD - VaultWarden Integration user story and test plan coordination`

## Plan approval status

Status: **draft for team review, not yet approved for independent tester**.

This document may be used by `impl`, `review4`, and the coordinator to discuss
scope and testability. Do not start the independent `tester` pass until:

1. review approves this plan or a revised version;
2. a human chooses whether to merge the mocked-sandbox testability work into
   `vk/43fd-vd-vaultwarden-i`;
3. any approved testability merge is implemented, reviewed, validated, and
   pushed for feature-branch CI if requested.

## Process source of truth

This plan follows the onboarding and mocked-sandbox process from
`vk/3237-vd-mocked-model`:

- `test-plans/onboarding/feature-work-process.md`
- `test-plans/onboarding/implementer-testing-process.md`
- `test-plans/onboarding/independent-tester-prompt.md`
- `test-plans/onboarding/playwright-manual-to-e2e.md`
- `test-plans/onboarding/vk-mocked-sandbox.md`

Use the mocked VK sandbox testability work before running the browser-visible
acceptance plan when practical. In this branch, that work was merged from local
weekly-dev `vk/05a2-vd-weekly-dev-br` at `351aa1c`, which already contained the
mocked-model sandbox changes. The sandbox provides a same-origin VD/VK front
door, qa-mode VK backend, `empty` and `basic-seeded` fixture reset commands,
one unified mocked-sandbox E2E entrypoint, Playwright CLI snapshot/ref workflow,
and transcript requirements for manual-to-E2E conversion.

Implementation and review for the Vardash/Settings branch are already complete.
The remaining goal of this plan is to make acceptance testing deterministic
enough for an independent `tester` pass, and to decide whether merging the
`vk/3237-vd-mocked-model` testability branch into this branch is the
lowest-risk way to run that pass.

For each milestone:

1. Treat this document as the user-story and acceptance source of truth.
2. Confirm implementation exists, or merge only the approved testability harness
   needed to run the plan if explicitly authorized.
3. Request focused review when new integration/testability code is merged.
4. Run independent tester validation and record JSON results keyed by
   `TEST_CASE_*`.
5. If tester fails, loop implementation → review → tester until approved or
   explicitly deferred by a human.

## Role ownership

- **Coordinator/overseer** owns M0 review-readiness evidence, M5 CI/security
  evidence, Beads forms, and sequencing decisions.
- **Impl** owns any approved testability merge/conflict resolution and records
  implementer validation before review.
- **Review4** owns review of the plan and any testability merge.
- **Tester** owns the independent browser-visible pass for M1–M4 and records
  literal results. Tester may reference M0/M5 coordinator evidence instead of
  independently rerunning every CI/security check unless the plan or review asks
  otherwise.
- **E2E author/impl** owns converting tester transcripts into committed
  Playwright tests when separately authorized.

## Global test constraints

- Do not merge into weekly-dev without explicit human authorization.
- Do not use real model-provider tokens.
- Prefer the `basic-seeded` mocked VK sandbox fixture for normal Vardash UI
  validation.
- Use `empty` only for first-run/onboarding behavior.
- Perform mutating acceptance steps through the VD UI unless a test case
  explicitly allows setup by fixture reset.
- Allowed setup shortcuts:
  - fixture reset commands from the mocked sandbox docs;
  - creating disposable repos under the sandbox's `$DISPOSABLE_REPO_DIR`;
  - inspecting PR/check status with GitHub CLI;
  - reading server tests/docs as evidence for coordinator-owned M5 cases.
- Direct API mutation is not allowed for browser-visible user flows unless a
  test case explicitly names it.
- Record exact commands, URLs, Playwright CLI session names, screenshot paths,
  transcript paths, and cleanup evidence on the tester bead.
- Do not commit Playwright CLI snapshots, traces, screenshots, videos, or raw
  generated drafts.
- Keep Vardash security boundaries intact:
  - no secret reveal UI;
  - no raw resolved env preview;
  - no stdout/stderr/log/tmux inspection;
  - normal agent/session env must not receive Vardash secrets;
  - UI-facing calls must be workspace-scoped;
  - repo-only server routes stay disabled by default.

## Required sandbox command skeleton

Use the exact commands from the mocked-sandbox onboarding docs after the
testability branch is available in this worktree:

```bash
# Typical state for Vardash browser acceptance.
npm run e2e:vk-mocked-sandbox:reset -- --variant basic-seeded
npm run dev:vk-mocked-sandbox
```

Open the printed VD URL with Playwright CLI:

```bash
PW_SESSION="vd-vardash-$(date +%Y%m%d%H%M%S)"
pnpm playwright:cli -s="$PW_SESSION" open "$VD_URL"
pnpm playwright:cli -s="$PW_SESSION" resize 1280 900
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

For first-run/onboarding-specific checks:

```bash
npm run e2e:vk-mocked-sandbox:reset -- --variant empty
```

Cleanup after the sandbox stops:

```bash
pgrep -af 'vk-mocked-sandbox|cargo run --features qa-mode|pnpm --filter @vibe/local-web|caddy run --config .*vk-mocked-sandbox'
```

Expected cleanup result: no live process belongs to this sandbox checkout/run
directory. Ignore the `pgrep` command itself and unrelated processes from other
worktrees.

## Result schema

Tester must post a JSON comment on the tester bead. Use one object key per
accepted test-case ID:

```json
{
  "TEST_CASE_M1A": {
    "status": "PASS",
    "commands": ["pnpm playwright:cli -s=... snapshot --json"],
    "url": "http://localhost:50005",
    "artifacts": ["/tmp/vd-vardash-.../final.png"],
    "notes": "Settings tab visible and renderer loaded."
  },
  "TEST_CASE_M3E": {
    "status": "BLOCKED",
    "notes": "No deterministic unresolved-repo-root fixture exists yet."
  }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

Each `FAIL` or `BLOCKED` entry must include:

- observed behavior;
- expected behavior;
- exact setup/data state;
- commands/URLs/artifacts;
- smallest actionable fix or follow-up question.

## M0A — Review-only mocked-sandbox readiness

### User story

As an implementer, reviewer, or tester, I can run VD/VK end-to-end acceptance
tests against a deterministic mocked VK sandbox without real model tokens, broad
manual setup, or unsafe local-state cleanup.

### Acceptance and tests

- `TEST_CASE_M0A — onboarding docs reviewed`
  - Review all onboarding docs listed above.
  - Expected: tester and reviewers understand the approved flow: story first,
    deterministic acceptance steps, Playwright CLI snapshot/ref loop,
    transcript artifacts, focused E2E conversion, and independent tester JSON
    result recording.

- `TEST_CASE_M0B — mocked-model branch testability review`
  - Inspect the mocked-sandbox/testability changes merged from local weekly-dev
    `351aa1c`, and compare them with `vk/3237-vd-mocked-model` if needed.
  - Expected: branch provides or preserves `dev:vk-mocked-sandbox`, fixture
    reset/validate/snapshot commands, unified
    `test:e2e:vk-mocked-sandbox` entrypoint, same-origin Caddy routing,
    qa-mode VK execution, and Playwright CLI support.

- `TEST_CASE_M0C — merge feasibility for testability branch`
  - Without modifying the feature branch, check merge-tree feasibility for
    merging the selected mocked-sandbox source into
    `vk/43fd-vd-vaultwarden-i`.
  - Expected: report whether conflicts are absent, automatic but high-risk, or
    manual. Highlight broad areas such as Dockerfile, package/lock, Caddy/CI,
    WorkspaceShell, craft-surface code/tests, Forms tab, and Settings tab.

- `TEST_CASE_M0D — current branch already has prerequisites`
  - Inspect the current branch for mocked-sandbox commands and Playwright CLI
    support.
  - Expected: record which prerequisites are already present and which require
    the mocked-model branch.

## M0B — Approved mocked-sandbox testability merge

### User story

As an implementer, I can merge only the testability harness needed for
deterministic acceptance testing into this feature branch without regressing the
approved Vardash/Settings or weekly-dev Forms behavior.

### Acceptance and tests

- `TEST_CASE_M0E — feature-branch-only mocked-sandbox merge`
  - Only if human-authorized, merge the selected mocked-sandbox source into this
    feature branch. For the 2026-08-12 authorization, the selected source was
    local weekly-dev `vk/05a2-vd-weekly-dev-br` at `351aa1c` because it already
    contained the mock test changes.
  - Expected: no weekly-dev merge occurs. Vardash files are preserved even
    though the mocked-sandbox source predates some Vardash work. Weekly-dev
    Forms and Vardash Settings both remain generated workspace tabs.

- `TEST_CASE_M0F — sandbox dependency and fixture smoke`
  - From the merged/testability-ready branch, run:
    - `npm run e2e:vk-mocked-sandbox:validate -- --variant basic-seeded`
    - `npm run e2e:vk-mocked-sandbox:validate -- --variant empty`
    - `npm run prepare:vk-mocked-sandbox`
  - Expected: fixture manifests validate, prepare prints VD URL / VK frontend
    URL / run dir, and no long-running sandbox process is left behind.

- `TEST_CASE_M0G — CI and static validation baseline`
  - Confirm PR #48 CI status and local checks after any testability merge.
  - Expected: PR or local validation includes `npm run check-types`,
    targeted Vardash/Settings tests, `git diff --check`, and any focused
    sandbox harness tests affected by the merge.

- `TEST_CASE_M0H — mocked-sandbox E2E entrypoint list`
  - Run `npm run test:e2e:vk-mocked-sandbox -- --list`.
  - Expected: the unified mocked-sandbox E2E entrypoint lists available tests
    successfully. Fixture variants are selected through reset commands such as
    `npm run e2e:vk-mocked-sandbox:reset -- --variant basic-seeded` and
    `npm run e2e:vk-mocked-sandbox:reset -- --variant empty`, not separate
    `fresh` / `seeded` npm scripts in this merged branch.

## M1 — Workspace Settings entry and repo selection

### User story

As a VD user working inside a workspace-backed craft, I can find Vardash in the
built-in Settings tab, choose the correct repo, and avoid deprecated or
workspace-less entry paths.

### Acceptance and tests

- `TEST_CASE_M1A — Settings tab is generated for workspace crafts`
  - Start the mocked sandbox with `basic-seeded`.
  - Open the printed VD URL in a fresh Playwright CLI session.
  - Open the seeded workspace-backed craft.
  - Expected: built-in tabs include Agent, Code, Beads, Forms, and Settings.
    Settings is present only for workspace-backed crafts and has a working
    renderer, not an unknown internal route.

- `TEST_CASE_M1B — Vardash menu appears in Settings`
  - Open the Settings tab.
  - Select the Vardash settings menu.
  - Expected: Vardash loads inside Settings using the active craft workspace
    context. No global workspace inference is visible to the user.

- `TEST_CASE_M1C — repo selection is explicit`
  - In a single-repo fixture, open Vardash.
  - In a multi-repo fixture or manually-created multi-repo workspace, open
    Vardash.
  - Expected: single-repo workspaces auto-select that repo; multi-repo
    workspaces require explicit repo selection before any Vardash panels render.
  - Conditional handling: if no deterministic multi-repo fixture exists after
    M0B, mark the multi-repo half `BLOCKED` and include the fixture gap as the
    actionable follow-up. Do not fake this with direct API mutation.

- `TEST_CASE_M1D — deprecated direct paths are absent`
  - Search the UI for Vardash links in SpacesOverview and try direct navigation
    to `/dashboard/vardash`.
  - Expected: SpacesOverview does not expose Vardash links, and the old direct
    production route is not available. The supported path is workspace craft →
    Settings → Vardash.

- `TEST_CASE_M1E — workspace-scoped network boundary`
  - Inspect browser requests while loading Vardash panels.
  - Expected: UI-facing Vardash requests use
    `/dashboard/api/vardash/workspaces/:workspaceId/repos/:repoId/...` paths.
    No production UI request uses repo-only Vardash routes.

## M2 — Environment keys, saved values, and import safety

### User story

As a repo maintainer, I can define required env keys, save secret/plain values,
choose repo defaults and workspace overrides, and import `.env` content without
accidentally revealing secrets.

### Acceptance and tests

- `TEST_CASE_M2A — create secret and plain keys`
  - In Vardash Settings, add one required secret key and one optional plain key.
  - Expected: the overview shows Secret/Plain badges and required/optional
    state. Description guidance says descriptions are metadata and should not
    include secret material.

- `TEST_CASE_M2B — secret saved values are write-only`
  - Save a secret value, reload the panel, and inspect rendered metadata.
  - Expected: secret saved values show metadata such as saved-value name and
    "Secret saved"; raw secret plaintext is never rendered after save.

- `TEST_CASE_M2C — plain saved values are recallable`
  - Save a plain value and reload the panel.
  - Expected: plain saved values remain visible as intended, and changing a key
    from plain to secret invalidates stale plaintext cache.

- `TEST_CASE_M2D — repo default and workspace selection semantics`
  - Set a repo default, then set and clear a workspace selection.
  - Expected: the UI labels `inherit repo default`; readiness/overview refreshes
    after selection changes; no stale selected metadata remains.

- `TEST_CASE_M2E — pasted `.env` import dry-run`
  - Paste `.env` content containing secret-like values and run dry-run.
  - Expected: pasted values default to Secret, preview shows keys/actions only,
    and diagnostics/conflicts do not echo raw pasted values.

- `TEST_CASE_M2F — sample/template import`
  - Import `.env.sample` / `.env.example` style content.
  - Expected: keys are seeded as required metadata only and no saved values are
    created.

- `TEST_CASE_M2G — import conflict no partial mutation`
  - Run import with duplicate keys, existing saved-value-name conflicts, or
    secret-to-plain-with-existing-values conflicts.
  - Expected: Apply is disabled or returns conflict before mutation; earlier
    non-conflicting keys in the same import are not created.

## M3 — Process definitions and launch readiness

### User story

As a repo maintainer, I can define launchable repo processes, preserve legacy
`dev_server_script` provenance, and see whether a process is ready to launch
without exposing env values.

### Acceptance and tests

- `TEST_CASE_M3A — manual process definitions`
  - Add and edit a manual process definition.
  - Expected: process name, command, cwd, default marker, and Manual source
    render correctly. Edit mode does not allow ambiguous renaming that would
    create a second definition by accident.

- `TEST_CASE_M3B — legacy dev server import`
  - If the fixture has legacy `dev_server_script`, import it.
  - Expected: imported process is marked `Legacy dev_server_script`, idempotent,
    and default-setting by id preserves the legacy source.

- `TEST_CASE_M3C — readiness metadata only`
  - Select a process and inspect launch readiness.
  - Expected: readiness includes eligible/ineligible state, selected process
    metadata, missing required keys, selected saved-value metadata names, Varlock
    status, and selection semantics. It does not include raw secret values, raw
    plain values, or a resolved env object.

- `TEST_CASE_M3D — missing required blocks launch`
  - Mark a key required without selecting/providing a saved value.
  - Expected: readiness becomes ineligible with missing key metadata, and Launch
    is not available.

- `TEST_CASE_M3E — unresolved repo root is explicit`
  - Use a workspace/repo state where a safe repo root cannot be resolved.
  - Expected: readiness is ineligible with generic `repo_root_unresolved` style
    reason. UI does not claim the launch is ready if backend launch would fail.
  - Conditional handling: if no deterministic fixture can produce unresolved
    repo root, use existing API/unit-test evidence plus UI copy inspection and
    mark the browser portion `BLOCKED` with a fixture request.

- `TEST_CASE_M3F — Varlock policy displayed honestly`
  - Request Varlock when server runtime is disabled/unavailable, then without
    Varlock.
  - Expected: Varlock readiness mirrors server-controlled policy; requested
    unavailable Varlock is ineligible with generic reason; non-Varlock readiness
    continues normally.

## M4 — Explicit launch, status, stop, and isolation

### User story

As a user, I can explicitly launch a selected repo process with the repo's
resolved Vardash env, observe lifecycle status, and stop the process without
leaking env values into normal agent/session shells or UI logs.

### Acceptance and tests

- `TEST_CASE_M4A — successful explicit launch`
  - Configure required env values and a short-lived safe process such as
    `node -e "setTimeout(() => process.exit(0), 250)"` from an inside-repo cwd.
  - Click Launch from Vardash.
  - Expected: launch returns a stable run id, status moves through active states,
    and terminal status/exit code appears after natural exit.

- `TEST_CASE_M4B — active status polling`
  - Launch a process that remains active briefly.
  - Expected: launch status polls while `starting` / `running` / `stopping` and
    stops polling after `stopped` or `failed`.

- `TEST_CASE_M4C — stop behavior`
  - Launch a safe long-running process such as
    `node -e "setInterval(() => {}, 1000)"` from an inside-repo cwd and click
    Stop.
  - Expected: stop sends the documented termination behavior, UI transitions
    through stopping to terminal state, and a second stop is disabled or handled
    safely.

- `TEST_CASE_M4D — no raw env/log exposure`
  - Inspect the launch panel before, during, and after launch.
  - Expected: UI shows no raw resolved env preview, no secret reveal, no
    stdout/stderr/log streaming, and no tmux inspection.

- `TEST_CASE_M4E — normal agent/session env exclusion`
  - Compare normal Agent iframe/session behavior before and after a Vardash
    launch.
  - Expected: normal agent/session environment is unchanged by Vardash saved
    values; secrets enter only explicit Vardash launch children.
  - Accepted evidence: UI must not expose raw env values, existing automated
    launch/isolation tests may be cited, and tester should confirm normal Agent
    iframe UX still works after the Vardash launch. Do not attempt to introspect
    secret process env through unsafe OS-level tricks during manual testing.

- `TEST_CASE_M4F — cwd containment`
  - Try a process definition with null cwd, inside-repo relative cwd, and
    outside-repo cwd.
  - Expected: null resolves to repo root, inside-repo cwd is accepted, and
    outside-repo cwd is rejected with a generic secret-safe error.

## M5 — Deployment/runtime and security boundaries

### User story

As an operator, I can trust that the feature's runtime dependencies and route
boundaries are deliberate, CI-covered, and not overclaiming security.

Ownership: coordinator/reviewer evidence. Tester may reference these results
instead of rerunning CI/build/package checks unless review asks otherwise.

### Acceptance and tests

- `TEST_CASE_M5A — SQLCipher runtime packaging`
  - Verify CI jobs that build the full vkvd image and publish VK/VD image passed.
  - Expected: native SQLCipher package builds in CI; Docker dependencies include
    required build packages; no plaintext production store is used.

- `TEST_CASE_M5B — key-management behavior`
  - Run focused Vardash key-manager/store tests or inspect prior CI/local
    evidence.
  - Expected: key is generated with secure randomness, stored in VD private data
    outside repos/worktrees, permissions are validated, corrupt/missing key
    behavior is tested, and key material is never returned through APIs.

- `TEST_CASE_M5C — repo-only routes disabled by default`
  - Hit representative repo-only Vardash API paths without internal/test opt-in.
  - Expected: production/default registration returns 404; workspace-scoped
    routes remain available after validation.

- `TEST_CASE_M5D — PR CI evidence`
  - Inspect PR #48 check rollup.
  - Expected: all required checks are green, including typecheck, app server
    unit tests, workflow-core tests, full build, Playwright e2e, Docker build,
    container smoke, plugin Caddy validation, plugin API tests, Docker plugin
    runtime smoke, and publish build/finalize jobs.

- `TEST_CASE_M5E — docs do not overclaim`
  - Review `docs/vardash-mvp-plan.md` and `docs/vardash-ui-design.md`.
  - Expected: docs state Vardash is better than `.env` but not a full isolation
    boundary; launched processes, same-user/root/devbox compromise, and future
    logs/tmux/restart are correctly scoped.

## M6 — Independent tester pass and E2E-conversion handoff

### User story

As the release coordinator, I can receive independent tester evidence that maps
directly to this plan and is actionable if any acceptance step fails.

### Acceptance and tests

- `TEST_CASE_M6A — tester bead created`
  - Ask `tester` to run the independent pass using
    `test-plans/onboarding/independent-tester-prompt.md` and this plan.
  - Expected: tester creates a fresh tester bead referencing this test-plan bead
    and this markdown file.

- `TEST_CASE_M6B — literal plan execution`
  - Tester runs milestones M0–M5, using mocked sandbox startup, fixture reset,
    Playwright CLI, screenshots, and transcript artifacts where applicable.
  - Expected: tester records exact commands, URLs, session names, artifacts,
    cleanup evidence, and deviations.

- `TEST_CASE_M6C — JSON result comment`
  - Tester posts results on the tester bead.
  - Expected: result is JSON keyed by `TEST_CASE_*` IDs, with statuses limited
    to `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`.

- `TEST_CASE_M6D — failure loop`
  - If any test case fails or blocks, route the issue to implementation and
    review before asking tester to rerun the failed scope.
  - Expected: the branch is not treated as accepted until tester passes or a
    human explicitly defers the failure.

- `TEST_CASE_M6E — E2E conversion notes`
  - For browser-driven manual tests, collect transcript artifacts following
    `playwright-manual-to-e2e.md`.
  - Expected: a future E2E author can convert the accepted manual path into
    polished `tests/e2e/features/...` specs without relying on transient refs.
