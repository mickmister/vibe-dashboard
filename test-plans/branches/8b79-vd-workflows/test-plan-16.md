# Test Plan 16: Full-stack Gas City workflow orchestration E2E

Branch: `vk/8b79-vd-workflows`

Primary planning topic: full VD + VK + Gas City + Beads workflow orchestration acceptance

Status: test-plan/design only; no product code or test implementation in this slice

## Purpose

This plan defines the missing end-to-end acceptance coverage for the workflow
system after the VD-native workflow E2Es and Gas City packaging/provider slices.
The goal is to verify the complete product loop with real services:

1. a user configures or selects a workflow through the VD UI;
2. a user starts the workflow through the VD UI;
3. a second variant starts the same class of workflow through the generic
   `vibe-agent workflow` CLI;
4. Gas City/Beads coordinate the authoritative workflow/task state;
5. VK receives the expected agent messages through normal session/message paths;
6. test code fabricates controlled Beads interactions needed to advance the
   formula/workflow under test;
7. the next agent receives the correct follow-up message;
8. VD presents product-safe progress, failure, and recovery state.

This suite should close the current gap between:

- existing VD-native Docker E2Es for workflow runtime/UI/CLI callbacks; and
- existing Gas City unit/smoke validation for pinned runtime packaging, provider
  contracts, fanout preview/launch policy, lane policy, and merge/fan-in policy.

## Non-negotiable boundaries

- Use real Docker/containerized qa-mode services for official acceptance.
- Include VD, VK, pinned Gas City, pinned Beads, and the VD-owned
  `gc-session-vibe` bridge when the slice under test needs them.
- Do not seed workflow definitions directly into the DB when validating UI
  creation/configuration. Use VD UI or existing VD HTTP APIs as the test case
  specifies.
- Do not call private runtime completion helpers such as
  `runtime.completeAgentTurn` in E2E tests.
- Do not rely on websocket-only delivery for durable workflow/callback behavior.
- Do not expose raw shell/gc/bd/git commands, local paths, stdout/stderr,
  provider diagnostics, queue/webhook/internal IDs, raw XML/JSON, or generated
  pack paths in normal product UI/assertions.
- Gas City and Beads remain authoritative for orchestration/task truth. VD may
  assert product-safe read models and links only.

## Recommended test architecture

### Harness

Create a focused Docker Playwright spec, for example:

`tests/e2e/features/8b79-vd-workflows/gas-city-workflow-orchestration.spec.ts`

The harness should run through the existing workflow Docker command pattern and
set explicit fixture inputs, for example:

```bash
WORKFLOW_E2E_PLAYWRIGHT_ARGS="tests/e2e/features/8b79-vd-workflows/gas-city-workflow-orchestration.spec.ts" \
WORKFLOW_E2E_LOG_DIR=/tmp/vd-workflow-gas-city-orchestration-artifacts \
npm run test:e2e:vk-workflows-docker
```

If GC-specific fixture knobs are needed, they should be explicit environment
variables and copied into the container by the workflow E2E harness. Avoid hidden
host-path assumptions.

### Assertions split

Use both browser and API assertions, but keep each assertion at the right layer:

- **VD browser assertions**: user can configure/start/monitor workflows; run page
  explains what ran, who has the ball, what happened, next action, and product
  failure/recovery state.
- **VK API assertions**: expected messages were queued/delivered to the expected
  agent sessions; prompt content includes intended bead/task context; prompt
  content excludes internal/debug/provider terms.
- **Beads/GC fixture assertions**: controlled fabricated bead interactions cause
  the formula to advance; duplicate/replayed interactions are idempotent.
- **Activity/callback assertions**: CLI caller receives durable completion or
  blocked response via supported read model/callback path.

Avoid asserting all agent message content through the VK browser chat UI unless
that UI behavior is the product surface under test; VK API checks are less flaky
for message-boundary correctness.

## Test data and fixture model

The E2E suite needs a deterministic, test-only Beads/GC interaction fixture layer.
Acceptable approaches:

1. **Preferred first slice: typed fake Beads provider inside the Docker harness**
   backed by deterministic fixture endpoints/events, while still using real VD,
   VK, and Gas City runtime packaging.
2. **Later stronger slice: real `bd`/Beads repository fixture** initialized in the
   container, with all changes constrained to a temporary runtime directory.
3. **Avoid** direct DB mutation, raw `bd` CLI product output, or arbitrary shell
   commands from test assertions.

Fixture events should be named around product concepts, for example:

- `mark_bead_ready`
- `record_agent_result_note`
- `mark_review_changes_requested`
- `mark_review_approved`
- `mark_tester_found_bug`
- `mark_tester_approved`
- `simulate_agent_turn_abrupt_stop`
- `simulate_provider_unavailable`

The fixture layer may use lower-level test hooks internally, but normal VD/VK UI
and API output must remain product-safe.

## Acceptance cases

### TEST_CASE_GC_FULL_E2E_1A: VD UI configures and starts a Gas City-backed workflow

Given the Docker qa-mode stack is running with pinned Gas City and Beads,
when a user configures or selects a supported workflow through the VD UI and
starts it from the Workflows UI,
then the launch goes through the Gas City provider seam, returns product-safe
accepted/running state, and VD shows a clean run/story page.

Required assertions:

- workflow configuration/start is performed through VD UI;
- no workflow definition DB seed is used for this case;
- Gas City launch/read model indicates accepted/running through supported API;
- VD run page has product labels, not raw provider/transport terms;
- generated pack/formula refs, if visible, are product-safe or behind advanced
  diagnostics.

### TEST_CASE_GC_FULL_E2E_1B: VK receives expected first agent message

After TEST_CASE_GC_FULL_E2E_1A starts the workflow,
when the first Gas City-routed agent turn is created,
then VK API shows the expected agent/session received the expected message.

Required assertions:

- message appears through normal VK session/message API;
- message contains expected task/bead context such as bead ID and title;
- message contains expected workflow instruction/prompt content;
- message does not contain raw `bd`, `gc`, shell/git commands, local paths,
  stdout/stderr, provider diagnostics, queue/webhook/internal IDs, raw generated
  pack paths, or prompt asset provenance clutter.

### TEST_CASE_GC_FULL_E2E_1C: Fabricated Beads interaction advances to the next agent

Given the first agent has received work,
when the E2E fixture records the expected Beads/Gas City interaction for that
formula step,
then Gas City advances and VK receives the next expected agent message.

Required assertions:

- fabricated interaction uses a typed fixture/provider API, not raw product UI
  command text;
- the next VK message is delivered to the correct role/session;
- duplicate replay of the same fabricated interaction does not create duplicate
  next-agent messages;
- VD run page updates with product-safe timeline/status.

### TEST_CASE_GC_FULL_E2E_1D: CLI starts equivalent workflow and returns detached

Given the Docker qa-mode stack is running and a workspace ID is available,
when `vibe-agent workflow run <workflow> --workspace <id> --bead <id> ...` starts
an equivalent workflow,
then the CLI returns immediately with clean run ID/status/URL and wait-later/end
turn instructions.

Required assertions:

- command is generic `vibe-agent workflow`, not a bespoke workflow command;
- no `--wait` behavior is required for this slice;
- launch uses supported VD workflow APIs and Gas City provider seam;
- normal CLI output and `--json` output avoid raw XML/XSD, prompt refs,
  content hashes, provider diagnostics, local paths, shell/bd/git command text,
  queue/webhook/internal IDs, `runReady`, and `WorkflowStepState`.

### TEST_CASE_GC_FULL_E2E_1E: CLI caller receives later completion or blocked response

Given TEST_CASE_GC_FULL_E2E_1D launched a workflow with caller response enabled,
when the workflow reaches terminal success or product-safe blocked state,
then the caller session receives a durable follow-up response and activity/read
models reflect the callback.

Required assertions:

- durable latest-response/callback path is used;
- callback delivery does not depend on websocket availability;
- activity v1 snapshot/websocket can observe delivered callback when available;
- callback text is product-safe and deduped by stable callback ID.

### TEST_CASE_GC_FULL_E2E_2A: Agent turn stops short and recovery is attempted

Given a Gas City-backed workflow has started an agent turn,
when the VK/qa-mode fixture simulates an abrupt or short agent turn before a
usable final response/result is available,
then the system detects the stopped-short state and performs bounded recovery or
blocks with a product-safe reason.

Required assertions:

- VK running-session awareness detects the abrupt/stuck/short turn;
- continuation nudge is sent at most the configured number of times;
- recovery uses product-safe prompt text and does not leak raw provider/transport
  internals;
- successful recovery advances the same workflow without duplicate turn effects;
- exhausted recovery produces product-safe blocked/needs-attention state in VD.

This case depends on the abrupt-turn recovery implementation. Until that slice is
implemented, this test case should be marked `BLOCKED_NOT_IMPLEMENTED`, not
passed by lower-level unit tests.

### TEST_CASE_GC_FULL_E2E_2B: Provider/Beads failure blocks safely

Given the workflow is running,
when the fixture simulates provider unavailable, invalid bead state, lane dirty,
wrong workspace, or quota/capacity failure,
then VD and CLI/read models show actionable product-safe blocked state.

Required assertions:

- no raw stdout/stderr/path/command/provider diagnostics leak;
- supported retry/recover action is shown only if implemented;
- otherwise UI clearly explains what the user can do next;
- terminal/blocked state is durable and idempotent on refresh/reconnect.

### TEST_CASE_GC_FULL_E2E_2C: Duplicate/replayed launch and interactions are idempotent

Given a UI or CLI launch is in progress or already accepted,
when the same launch key/request is replayed,
then no duplicate Gas City launch or duplicate VK agent message is created.

Given the same Beads interaction event is replayed,
then the next workflow transition/message is not duplicated.

Required assertions:

- same key + same request reconciles to existing accepted/running state;
- same key + different request blocks safely;
- duplicate fabricated interaction does not duplicate VK messages;
- status/read model remains product-safe.

## Failure and recovery matrix

| Failure | Expected product result | Required evidence |
| --- | --- | --- |
| Agent turn stops without final response | bounded continuation nudge or blocked recovery state | VK session state, nudge count, VD timeline |
| Agent returns invalid structured result | retry then blocked if exhausted | retry prompt/message evidence, VD blocked reason |
| Bead missing/removed | blocked | product-safe missing-bead reason |
| Bead no longer ready/terminal | skipped or blocked depending formula | product-safe reason and no launch |
| Lane dirty/held/unknown | blocked | lane reason code, no hidden lane creation |
| Provider unavailable | blocked/unavailable | capped safe warning, no raw diagnostics |
| Duplicate launch | reconciled | one GC launch, one VK first message |
| Duplicate interaction | idempotent no-op | one subsequent VK message |
| Callback delivery failure | terminal state preserved, failure audited | audit/read model, no rollback |

## Required artifacts

Each Docker E2E run should save artifacts under `WORKFLOW_E2E_LOG_DIR`, including:

- Playwright trace and video for browser UI cases;
- VD server logs;
- VK server logs;
- Gas City/Beads runtime smoke and launch logs with sensitive/raw output redacted
  or stored as non-product diagnostics;
- CLI stdout/stderr and parsed JSON output;
- VK API message snapshots for expected sessions;
- VD presentation/read-model snapshots;
- Beads/GC fixture event log;
- final summary JSON keyed by `TEST_CASE_GC_FULL_E2E_*`.

## Validation commands

Source/list checks for the eventual E2E implementation:

```bash
npm run check-types
pnpm --filter @vibe-dashboard/workflow-core test
npx playwright test --config playwright.vk-workflows-docker.config.ts \
  tests/e2e/features/8b79-vd-workflows/gas-city-workflow-orchestration.spec.ts --list
git diff --check
git status --short --branch
```

Required Docker E2E command when implemented:

```bash
WORKFLOW_E2E_PLAYWRIGHT_ARGS="tests/e2e/features/8b79-vd-workflows/gas-city-workflow-orchestration.spec.ts" \
WORKFLOW_E2E_LOG_DIR=/tmp/vd-workflow-gas-city-orchestration-artifacts \
npm run test:e2e:vk-workflows-docker
```

If the test requires scripted VK qa-mode responses, set an explicit fixture file:

```bash
VK_QA_SCRIPTED_OUTCOME_FILE=tests/e2e/fixtures/qa-scripted-gas-city-workflows.json \
WORKFLOW_E2E_PLAYWRIGHT_ARGS="tests/e2e/features/8b79-vd-workflows/gas-city-workflow-orchestration.spec.ts" \
WORKFLOW_E2E_LOG_DIR=/tmp/vd-workflow-gas-city-orchestration-artifacts \
npm run test:e2e:vk-workflows-docker
```

## Implementation ladder

1. **Plan/current slice**: this document only.
2. **Harness fixture slice**: add deterministic test-only Beads/GC fixture APIs or
   temporary Beads repo setup without product-surface raw command leakage.
3. **UI launch E2E slice**: VD UI config/start -> GC provider -> VK first message
   -> fabricated interaction -> next VK message -> VD run page.
4. **CLI launch E2E slice**: `vibe-agent workflow run` -> GC provider -> callback
   delivery/activity/read-model.
5. **Failure/recovery slice**: abrupt-turn detection/recovery, provider failure,
   duplicate launch/interaction idempotency.
6. **Stronger real-Beads slice**: replace or supplement typed fake fixture with a
   real temporary Beads repository if the provider implementation supports it.

## Tester PASS rules

A future implementation bead for this plan should PASS only when:

- the requested E2E variant runs in Docker qa-mode with VD, VK, Gas City, and
  Beads/runtime components required by that slice;
- assertions cross the real product/API boundaries named in the test case;
- failure artifacts are useful enough to diagnose which boundary failed;
- product-safety negative assertions are present for UI, CLI, VD read model, VK
  messages, and callback/activity output;
- unsupported future behavior is explicitly skipped/deferred, not silently mocked
  as passing.

A run should be BLOCKED, not FAILED, when Docker/Colima/storage/network prevents
service startup before product execution begins. Once Playwright reaches product
execution, spec failures should be treated as product/test failures with exact
artifacts.
