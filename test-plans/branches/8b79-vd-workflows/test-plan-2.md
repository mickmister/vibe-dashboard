# Test Plan 2: Workflow engine, presentation, human attention, and qa-mode acceptance roadmap

Branch: `vk/8b79-vd-workflows`

Roadmap bead: `vibe-kanban-vscode-web-450` — Workflow feature branch roadmap milestones

Related milestone beads:

- `vibe-kanban-vscode-web-450.1` — M82 update workflow core plan with final schema decisions
- `vibe-kanban-vscode-web-450.2` — M83 implement pure workflow-core TDD slice
- `vibe-kanban-vscode-web-450.3` — M84 integrate workflow core with durable VD runtime
- `vibe-kanban-vscode-web-450.4` — M85 add VK server-to-server read models for workflow presentation artifacts
- `vibe-kanban-vscode-web-450.5` — M86 design and implement human attention steps
- `vibe-kanban-vscode-web-450.6` — M87 build clean workflow presentation page
- `vibe-kanban-vscode-web-450.7` — M88 design workflow-to-workflow calls and bulk run queue
- `vibe-kanban-vscode-web-450.8` — M89 qa-mode integration and E2E acceptance suite

Related planning/decision beads:

- `vibe-kanban-vscode-web-5jq` — Decide final workflow schema details
- `vibe-kanban-vscode-web-b8n` — Discuss workflow-to-workflow calls in core plan
- `vibe-kanban-vscode-web-e3p` — Design workflow-to-workflow calls and bulk queued runs
- `vibe-kanban-vscode-web-fvm` — Decide final workflow core modeling details
- `vibe-kanban-vscode-web-o4n` — Decide workflow core engine follow-up semantics
- `vibe-kanban-vscode-web-okj` — Clarify workflow turn progression in plain English
- `vibe-kanban-vscode-web-3vb` — Clarify remaining strict V1 workflow core semantics
- `vibe-kanban-vscode-web-cb7` — Decide strict V1 workflow core semantics after contributor review
- `vibe-kanban-vscode-web-hnb` — Discuss workflow presentation UX - user/product concerns
- `vibe-kanban-vscode-web-a0e` — Discuss workflow presentation UX - reviewer concerns
- `vibe-kanban-vscode-web-pr4` — Discuss workflow presentation UX - implementer concerns
- `vibe-kanban-vscode-web-npv` — Design clean workflow presentation page

Related onboarding docs:

- [`../../onboarding/feature-work-process.md`](../../onboarding/feature-work-process.md)
- [`../../onboarding/implementer-testing-process.md`](../../onboarding/implementer-testing-process.md)
- [`../../onboarding/independent-tester-prompt.md`](../../onboarding/independent-tester-prompt.md)
- [`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md)
- [`../../onboarding/vk-mocked-sandbox.md`](../../onboarding/vk-mocked-sandbox.md)

Earlier branch acceptance plan:

- [`./test-plan-1.md`](./test-plan-1.md) — Durable workflow UI and webhook-driven qa-mode execution

## User stories

### USER_STORY_1 — Workflow author defines a deterministic agent workflow

As a workflow author, I want to describe a multi-state agent workflow in JSON
using product/domain terms, so that I can define roles, inputs, ordered steps,
decision actions, and terminal states without learning XState internals or
encoding orchestration behavior in code.

Success means:

- The authored JSON uses `initialState`, `states`, `owner`, `steps`, `actions`,
  and `targetState`.
- State/role/action IDs come from map keys, not duplicated nested `id` fields.
- Every non-terminal V1 state has one owner, non-empty steps, non-empty actions,
  and exactly one final decision step.
- Terminal states are authored as exactly `{ "terminal": true }`.
- Unknown workflow config fields fail fast with specific validation errors.
- The plan clearly explains that the schema is XState-inspired but is not
  direct XState config.

Primary beads: `vibe-kanban-vscode-web-450.1`,
`vibe-kanban-vscode-web-450.2`, `vibe-kanban-vscode-web-5jq`.

### USER_STORY_2 — Workflow engine advances one agent turn at a time

As the workflow system, I want a pure deterministic workflow core that plans one
agent turn at a time, waits for the agent turn to finish, records refs/history,
and then advances based on either a non-decision completion or a decision XML
action, so that durable runtime retries, loops, and restarts do not duplicate or
skip work.

Success means:

- V1 has no fire-and-forget agent message turns.
- `turnType: "non_decision"` waits for the current agent turn to complete and
  stores an opaque response ref.
- `turnType: "decision"` waits for completion, validates XML/result data, and
  applies a configured action.
- Same-state loops create a new visit/history entry rather than overwriting the
  previous visit.
- Terminal snapshots are no-ops for normal duplicate wakes.
- Invalid config/model errors are stable, specific, and testable.
- Invalid decision XML retries the same agent/turn with validation errors, then
  reaches a needs-attention/blocked state according to the final plan decision.

Primary beads: `vibe-kanban-vscode-web-450.2`,
`vibe-kanban-vscode-web-fvm`, `vibe-kanban-vscode-web-o4n`,
`vibe-kanban-vscode-web-okj`, `vibe-kanban-vscode-web-3vb`,
`vibe-kanban-vscode-web-cb7`.

### USER_STORY_3 — Existing durable VD runtime uses the generic core safely

As a user launching workflows from VD, I want the existing durable runtime to use
the generic workflow core while keeping restart recovery, webhooks, polling, and
idempotent side effects reliable, so that the workflow continues correctly even
when processes restart or duplicate events arrive.

Success means:

- Existing declarative workflow definitions continue to run.
- Stored workflow definitions remain restart-resumable.
- Legacy built-in instances without stored definitions still use built-in
  fallback semantics.
- Webhook wakeups advance work quickly, polling remains the correctness
  backstop, and duplicate/overlapping webhook events do not duplicate handoffs
  or notifications.
- Status/read APIs expose product-level state without requiring consumers to
  understand raw DB internals.

Primary beads: `vibe-kanban-vscode-web-450.3`,
`vibe-kanban-vscode-web-3g3`.

### USER_STORY_4 — VD reads needed VK data through HTTP APIs

As VD, I want server-to-server HTTP APIs for workflow-relevant VK data, so that
webhooks can remain lightweight wakeups and VD does not need to scrape
websockets/log streams to build workflow state or user-facing pages.

Success means:

- VK webhook subscription CRUD remains generic and supports VD
  self-provisioning.
- VK terminal execution webhooks contain refs only.
- VD can fetch final responses by execution/session refs through HTTP.
- Any additional clean-page data gaps, such as initial queued prompt previews or
  reliable per-turn commit refs, are exposed through bounded/ref-oriented HTTP
  APIs rather than log scraping.
- Secrets are not exposed in general config APIs.

Primary beads: `vibe-kanban-vscode-web-450.4`,
`vibe-kanban-vscode-web-450.6`.

### USER_STORY_5 — User sees a clean workflow presentation page

As a user/overseer, I want a clean workflow page that explains what work was
requested, which role acted, what each role was sent, what each role replied,
and what changed, so that I can understand the feature being built without
seeing webhook, queue, trigger, delivery, or raw ID implementation details.

Success means:

- The new page is separate from the existing debug/status dashboard.
- The page shows workflow name/status, original task, one linear timeline,
  role-based turn cards, initial/final messages where available, reliable
  commits where available, and VK session links.
- The page hides webhook status, trigger IDs, queue item IDs, execution process
  IDs, raw JSON, scheduler internals, and HMAC/provisioning details by default.
- The page survives refresh and is covered by Docker Playwright E2E with a full
  video artifact.

Primary beads: `vibe-kanban-vscode-web-450.6`,
`vibe-kanban-vscode-web-hnb`, `vibe-kanban-vscode-web-a0e`,
`vibe-kanban-vscode-web-pr4`, `vibe-kanban-vscode-web-npv`.

### USER_STORY_6 — User has an attention feed for human workflow turns

As a user, I want workflows that need my input to appear in a clear attention
feed and optionally notify me through adapters such as Discord, so that async
human decisions can resume workflows without being hidden in an agent log or
lost in one worktree.

Success means:

- Human turns are modeled as future workflow steps, not as special invalid XML
  escape hatches.
- A human turn creates a durable attention item/form request.
- Beads-form submission can complete the human step and resume the workflow.
- A cross-worktree feed can show items blocked on the user.
- Notification adapters are pluggable and can be added without coupling the pure
  core to Discord or any specific transport.

Primary bead: `vibe-kanban-vscode-web-450.5`.

### USER_STORY_7 — Workflows can call workflows later without breaking V1

As a workflow author, I want workflows to eventually call other workflows with
arguments, either blocking or fire-and-forget, as terminal action effects or
mid-workflow steps, so that complex work can be decomposed into reusable
workflow runs while a scheduler limits active turns and memory pressure.

Success means:

- V1 docs reserve the concept but do not add executable `workflow_call` fields
  or a `future` field to canonical JSON.
- Design notes cover blocking calls, fire-and-forget calls, terminal action
  calls, mid-workflow calls, and bulk batch run enqueueing.
- Parent/child links include child instance refs, child output refs/status
  summary for blocking calls, and ref-only behavior for fire-and-forget calls.
- Bulk queued runs are durable pending runs processed under global runtime
  active-turn limits and future workspace/worktree-lane capacity constraints.

Primary beads: `vibe-kanban-vscode-web-450.7`,
`vibe-kanban-vscode-web-e3p`, `vibe-kanban-vscode-web-b8n`.

### USER_STORY_8 — Testers validate workflows with controlled qa-mode agents

As an implementer, reviewer, or independent tester, I want the weekly-dev
mock-LLM/qa-mode sandbox to control actual agent messages during integration and
E2E tests, so that workflow behavior is validated through real VD/VK execution
paths without real model tokens or nondeterministic model output.

Success means:

- Tests use the containerized sandbox, not host-only ad hoc services.
- Mock agents can return deterministic final messages and malformed XML when a
  test needs retry/error coverage.
- Browser E2E covers happy path and representative product-level failures.
- The independent tester records JSON results keyed by this plan's test-case IDs
  and captures full videos where the plan requests them.

Primary bead: `vibe-kanban-vscode-web-450.8`.

## Constraints and decisions

- This branch is `vk/8b79-vd-workflows`.
- The latest weekly dev branch has been merged into both VD and VK branches.
- The mock LLM / qa-mode sandbox from weekly dev should be incorporated into all
  relevant integration and E2E tests.
- VK remains generic. VK should not know about VD.
- Webhooks are wakeups, not the source of truth.
- Server-to-server HTTP APIs should provide refs/read models needed by VD.
- V1 pure core must not depend on VK, DB, UI, XML parser implementation, or
  runtime scheduler implementation.
- Product-level errors should be actionable and specific; avoid generic
  `Something went wrong` failures.
- Sandbox startup is a prerequisite, not a product test case.
- Existing `test-plan-1.md` remains valid and should not be replaced by this
  roadmap plan.

## Prerequisites and sandbox setup

These steps prepare the environment. They are not product acceptance test cases.
If any prerequisite fails, record `BLOCKED` on the implementation/tester bead and
fix the environment or harness before scoring product behavior.

1. Read [`../../onboarding/vk-mocked-sandbox.md`](../../onboarding/vk-mocked-sandbox.md).
2. Start the Docker/containerized VD + VK qa-mode sandbox for this branch.
3. Record:
   - VD URL
   - VK API base URL
   - sandbox/container name
   - current VD commit
   - current VK commit
   - mock-script fixture or environment settings
   - cleanup command
4. Confirm the sandbox uses mocked/qa-mode providers and does not require real
   model-provider tokens.
5. Confirm VD `/dashboard/api/*` routes return JSON rather than SPA fallback.
6. Confirm VK server-to-server HTTP APIs are reachable from VD.
7. Confirm Playwright can open the VD URL.
8. Confirm generated artifacts, videos, screenshots, and traces will be written
   outside committed source paths unless explicitly approved.

## Agent-driven browser workflow

Use Playwright CLI for exploratory browser testing. Convert approved browser
flows to committed Playwright tests with
[`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md).

```bash
PW_SESSION="vd-workflows-roadmap-$(date +%Y%m%d%H%M%S)"
pnpm playwright:cli -s="$PW_SESSION" open "$VD_URL"
pnpm playwright:cli -s="$PW_SESSION" resize 1280 900
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

For each important interaction:

1. Take a fresh snapshot.
2. Use the latest snapshot refs only for exploration.
3. Generate stable locator hints for committed tests.
4. Record commands, URLs, screenshots/videos, and observed results on the bead.
5. Replace transient refs with semantic locators in committed Playwright tests.

## Test cases

### TEST_CASE_M82_1A — Plan captures final workflow schema decisions

Milestone: `vibe-kanban-vscode-web-450.1`

User story coverage: `USER_STORY_1`, `USER_STORY_7`, `USER_STORY_8`

Steps:

1. Open `docs/workflows/agent-workflow-core-implementation-plan.md`.
2. Confirm the plan defines the canonical workflow JSON with domain names:
   - `initialState`
   - `states`
   - `owner`
   - `steps`
   - `actions`
   - `targetState`
3. Confirm the plan explicitly says the format is XState-inspired but not direct
   XState-compatible config.
4. Confirm no executable `future` field is included in canonical V1 JSON.
5. Confirm workflow-to-workflow calls are documented as future/design-only and
   linked back to `vibe-kanban-vscode-web-450.7` / `vibe-kanban-vscode-web-e3p`.
6. Confirm test setup is documented with four layers:
   - pure workflow-core unit tests
   - VD runtime integration tests
   - VK/VD HTTP read-model tests
   - Docker qa-mode/mock LLM E2E tests
7. Confirm the plan records the unresolved/latest-form nuance around `blocked`:
   terminal states are exact workflow states; needs-attention/blocked runtime
   behavior must be decided or explicitly scoped before code relies on it.

Product-level error cases:

- If the plan mixes XState names and domain names, reviewer should request a
  docs correction before implementation.
- If the plan includes executable future-only schema fields, reviewer should
  request removal or clear V1 rejection semantics.
- If the plan omits test setup, implementation should not start because the
  user explicitly asked to organize testing around mock LLM/qa-mode.

Expected:

- The implementation plan is self-contained enough for `engine` to begin TDD
  without re-asking the same schema questions.
- Review4 can approve the docs update before code changes.

### TEST_CASE_M83_1A — Normalize a valid V1 workflow definition

Milestone: `vibe-kanban-vscode-web-450.2`

User story coverage: `USER_STORY_1`, `USER_STORY_2`

Steps:

1. In pure workflow-core unit tests, construct a V1 definition with:
   - root `id`, `version: 1`, `name`, `inputs`, `roles`, `initialState`,
     `states`
   - active states keyed by state ID
   - roles keyed by role ID
   - actions keyed by action ID
   - active state `owner`
   - ordered `steps`
   - a final `agent_turn` decision step
   - terminal state `{ "terminal": true }`
2. Call the normalization API.
3. Inspect the normalized output.

Product-level error cases:

- Missing `initialState` should fail with a stable invalid-definition error.
- `initialState` pointing to a missing state should fail with a stable error.
- Active state owner pointing to a missing role should fail with a stable error.
- Action `targetState` pointing to a missing state should fail with a stable
  error.
- Terminal state with `owner`, `steps`, or `actions` should fail with a stable
  error.
- Unknown config fields in root/state/action/step objects should fail fast and
  identify the path.

Expected:

- Normalization is pure and does not mutate input JSON.
- Authored JSON derives role/state/action IDs from map keys.
- Internal normalized objects may have explicit IDs, but the authored JSON does
  not require duplicated `id` fields.
- Errors expose stable codes and useful paths.

### TEST_CASE_M83_1B — Enforce strict active-state decision invariants

Milestone: `vibe-kanban-vscode-web-450.2`

User story coverage: `USER_STORY_1`, `USER_STORY_2`

Steps:

1. Create unit-test definitions for invalid active states:
   - no owner
   - no steps
   - no actions
   - no decision step
   - decision step not final
   - more than one decision step
   - steps after decision step
2. Normalize each invalid definition.
3. Assert the correct stable validation errors.
4. Create a valid definition with one or more non-decision steps followed by one
   final decision step.
5. Assert the valid definition normalizes.

Expected:

- V1 always follows: enter state → run steps in order → final decision chooses
  configured action → transition.
- Ambiguous actionless/auto-transition states are rejected and documented as
  future work.

### TEST_CASE_M83_2A — Advance non-decision and decision turns deterministically

Milestone: `vibe-kanban-vscode-web-450.2`

User story coverage: `USER_STORY_2`

Steps:

1. Create a deterministic snapshot with injected clock and ID factory.
2. Plan the current non-decision agent turn.
3. Complete that turn with an opaque response ref.
4. Assert the next planned turn is the next step in the same state.
5. Complete the final decision turn with valid action XML.
6. Assert the engine applies the configured action target, not an agent-provided
   target.
7. Assert transition history includes:
   - state visit ID
   - from/to state
   - action ID
   - parsed result fields
   - raw XML bounded according to the configured cap when enabled
8. Repeat with a same-state loop action.
9. Assert the loop creates a new state visit rather than overwriting the old
   visit.

Product-level error cases:

- Completing a turn that is not current should return a no-op/ignored result or
  stable non-advancing error according to the final plan semantics.
- Completing a decision turn with an unknown action should fail validation and
  not transition.
- Completing a decision turn with missing required result fields should fail
  validation and not transition.
- Terminal snapshots should not plan additional turns.

Expected:

- Advancement is deterministic, pure, and idempotent under duplicate wakes.
- Same-state loops are supported.
- Response refs are stored without coupling to VK types.

### TEST_CASE_M83_2B — Invalid decision XML retry and needs-attention behavior

Milestone: `vibe-kanban-vscode-web-450.2`

User story coverage: `USER_STORY_2`, `USER_STORY_6`

Steps:

1. Configure a decision step with invalid XML retry policy.
2. Complete the decision turn with malformed XML.
3. Assert no workflow action is applied.
4. Assert the workflow remains at the same state/decision turn and plans a retry
   prompt for the same role.
5. Assert the retry prompt includes validation errors.
6. Repeat until retry limit is exhausted.
7. Assert the snapshot reaches the final needs-attention behavior defined in
   the M82 plan.

Product-level error cases:

- Retry should not accidentally transition to a normal workflow action.
- `notify_user` should not be used as a special invalid-response escape hatch.
- Retry exhaustion should produce a user-actionable state, not a generic
  `Something went wrong` failure.

Expected:

- Invalid XML is treated as failure to satisfy the current decision contract.
- The same agent is asked again for the same decision until retry policy is
  exhausted.
- Exhaustion produces a durable user-attention state that later UI/feed work can
  expose.

### TEST_CASE_M84_1A — Existing two-agent workflow still runs after core integration

Milestone: `vibe-kanban-vscode-web-450.3`

User story coverage: `USER_STORY_3`, `USER_STORY_8`

Steps:

1. Start the Docker qa-mode workflow sandbox.
2. Launch the existing `two-agent-review-round` workflow from VD UI or API.
3. Let qa-mode complete the implementer/source turn.
4. Let VD advance to reviewer.
5. Let qa-mode complete the reviewer turn.
6. Confirm the workflow completes.
7. Confirm final output remains refs-oriented and does not store full VK
   transcripts unless intentionally exposed as bounded presentation content.
8. Restart VD during or after a wait state and run worker recovery.
9. Confirm the workflow resumes from persisted state/definition.

Product-level error cases:

- Duplicate webhook delivery should not duplicate the reviewer handoff.
- Overlapping webhook wakeups should coalesce and still run one follow-up pass.
- Polling should eventually recover if webhook delivery is missed.
- Legacy built-in instances without stored definitions should not accidentally
  use incompatible DB override definitions.

Expected:

- Current approved M79-M81 behavior remains intact.
- Core integration does not regress durability or idempotence.

### TEST_CASE_M84_1B — Runtime handles terminal/no-op and stale observations safely

Milestone: `vibe-kanban-vscode-web-450.3`

User story coverage: `USER_STORY_3`

Steps:

1. Create or seed a running workflow instance waiting for an agent turn.
2. Deliver the matching terminal VK event.
3. Deliver the same event again.
4. Deliver an event for an old turn or wrong instance/session.
5. Run polling after the workflow has completed.
6. Inspect workflow state, inbox/delivery records, and user-visible status.

Product-level error cases:

- Duplicate/stale observations should not create noisy user-facing errors.
- Wrong-session/wrong-workspace observations should not advance the workflow.
- Completed workflows should remain complete and should not re-notify.

Expected:

- Normal duplicate/stale runtime wakes are handled as no-op/ignored observations
  according to the final core semantics.
- Invalid model/config errors remain hard failures with stable codes.

### TEST_CASE_M85_1A — VD fetches final responses through VK HTTP APIs

Milestone: `vibe-kanban-vscode-web-450.4`

User story coverage: `USER_STORY_4`, `USER_STORY_5`

Steps:

1. Run a qa-mode VK execution through the workflow path.
2. Record execution/session refs from VD workflow state.
3. From VD server code or integration test, call VK HTTP response-read APIs:
   - final message by execution id
   - latest response by session id, with optional after filters
4. Confirm the response read model includes:
   - execution process id
   - session id
   - workspace id
   - terminal status
   - completed time
   - content/summary when available
   - truncation flag
   - max chars/source kind
5. Confirm no websocket/log stream scraping is needed for this data.

Product-level error cases:

- Missing execution response should return a specific not-found/unavailable
  state, not a blank page.
- Truncated response should be marked as truncated and link users to VK session
  for full context.
- VK unavailable should surface a retryable server-to-server read error.

Expected:

- VD can build response portions of the clean workflow presentation from HTTP
  read APIs.
- Webhooks remain wakeups only.

### TEST_CASE_M85_1B — Additional presentation artifacts have trustworthy read models

Milestone: `vibe-kanban-vscode-web-450.4`

User story coverage: `USER_STORY_4`, `USER_STORY_5`

Steps:

1. Identify whether clean presentation needs exact initial queued message text,
   bounded prompt previews, and commit refs.
2. For each data item, verify an explicit source of truth exists:
   - existing VK HTTP API
   - new VK HTTP API
   - bounded/redacted VD storage
   - explicit deferral with UI fallback
3. If adding VK APIs, test them through server-to-server HTTP calls.
4. Verify no secrets or full unintended transcripts are exposed through general
   config/read APIs.

Product-level error cases:

- Do not infer commits by parsing agent text unless a separate decision approves
  it.
- Do not present truncated/partial content as complete.
- Do not leak signing secrets or raw provider credentials.

Expected:

- The clean presentation page has enough reliable data to be useful.
- Missing optional data is omitted or clearly marked unavailable.

### TEST_CASE_M86_1A — Human turn creates durable attention item

Milestone: `vibe-kanban-vscode-web-450.5`

User story coverage: `USER_STORY_6`

Steps:

1. Configure or simulate a workflow reaching a future `human_turn` or human
   decision step.
2. Let the runtime plan the human step.
3. Confirm the runtime creates a durable attention item/form request rather than
   sending an agent prompt.
4. Open the user attention/feed surface.
5. Locate the item by workflow name, state/role, task, and requested action.
6. Confirm the item links to the workflow presentation page and form/details.

Product-level error cases:

- Missing notification adapter should not lose the attention item.
- Duplicate worker wakeups should not create duplicate human forms.
- If form creation fails, workflow should show a specific attention/form error.
- Human-turn items should be visible across worktrees if that feed exists.

Expected:

- Human-required work is visible as a user-facing blocked-on-me item.
- The user does not need to inspect logs or raw workflow state to know input is
  required.

### TEST_CASE_M86_1B — Beads-form submission resumes workflow

Milestone: `vibe-kanban-vscode-web-450.5`

User story coverage: `USER_STORY_6`

Steps:

1. Open the generated beads-form for a waiting human turn.
2. Submit valid data.
3. Confirm the workflow receives the form submission as the human-turn
   completion observation.
4. Confirm the workflow advances to the next step/state.
5. Refresh the attention feed.
6. Confirm the item is resolved/closed or marked completed.

Product-level error cases:

- Invalid/missing form fields should show field-level errors and not advance.
- Double submission should be idempotent.
- Submission for an old state visit should not advance the current workflow.
- If workflow is already terminal, submission should not create a noisy user
  error.

Expected:

- Human workflow steps can pause and resume asynchronously.
- Beads-form is a durable integration point for human decisions.

### TEST_CASE_M87_1A — Clean workflow presentation happy path

Milestone: `vibe-kanban-vscode-web-450.6`

User story coverage: `USER_STORY_5`, `USER_STORY_8`

Steps:

1. Start the Docker qa-mode workflow sandbox.
2. Launch `two-agent-review-round` from VD UI using deterministic qa-mode
   messages.
3. Navigate to the new clean workflow presentation page for the instance.
4. Observe the running/waiting state while the workflow progresses.
5. Wait for completion.
6. Verify the page shows:
   - workflow name
   - human status
   - original task
   - one linear timeline
   - Implementer role card
   - Reviewer role card
   - initial message area when available
   - final response area
   - reliable commit section only when data is authoritative
   - readable VK session links
7. Refresh the page.
8. Verify the same clean presentation still renders.
9. Record a full Playwright video showing launch, progress, and completed page.

Product-level error cases:

- Page should not show visible debug terms such as webhook, HMAC, delivery id,
  trigger id, queue item id, execution process id, WorkflowStepState, runReady,
  or raw JSON.
- Missing final response should show a specific response-unavailable state with
  retry/open-session action.
- Truncated final response should be labeled and should link to VK session.
- Missing optional commit refs should omit the commit section rather than claim
  no commits with false certainty.

Expected:

- A user can understand what work was done without decoding workflow internals.
- The existing debug/status UI and `test-plan-1.md` remain available separately.

### TEST_CASE_M87_1B — Clean presentation page error and attention states

Milestone: `vibe-kanban-vscode-web-450.6`

User story coverage: `USER_STORY_5`, `USER_STORY_6`

Steps:

1. Open a nonexistent workflow presentation URL.
2. Open a workflow that is waiting for an agent.
3. Open a workflow that is blocked/needs attention or simulate that state.
4. Open a workflow whose VK response read fails.
5. Inspect visible copy and actions.

Product-level error cases:

- Nonexistent workflow should show `Workflow not found` or equivalent specific
  state, not a stack trace.
- Waiting workflow should show the current role and session link.
- Needs-attention workflow should show the user action needed.
- VK read failure should not blank the entire page; available timeline/task data
  should still render.

Expected:

- Error states are product-level and actionable.
- The page never becomes a debug dump.

### TEST_CASE_M88_1A — Workflow-call design is documented but rejected by V1 core

Milestone: `vibe-kanban-vscode-web-450.7`

User story coverage: `USER_STORY_7`

Steps:

1. Open the workflow-call design docs/bead notes.
2. Confirm they describe:
   - blocking workflow call
   - fire-and-forget workflow call
   - terminal action call
   - mid-workflow call step
   - bulk batch enqueue
   - child instance refs
   - child output/status refs for blocking calls
   - durable pending run queue
   - global active-turn limits
   - future per-workspace/worktree-lane constraints
3. Add a `workflow_call` step to a V1 definition in a pure-core test.
4. Normalize the definition.

Product-level error cases:

- V1 core should reject executable `workflow_call` with a clear unsupported step
  type error.
- Canonical V1 JSON should not include a `future` field.
- Docs should not imply fire-and-forget agent turns are available in V1.

Expected:

- Long-term workflow-call behavior is captured in beads/docs.
- V1 executable schema remains strict and small.

### TEST_CASE_M88_1B — Bulk run queue design respects active-turn limits

Milestone: `vibe-kanban-vscode-web-450.7`

User story coverage: `USER_STORY_7`

Steps:

1. Review the bulk queue design in the workflow-call milestone.
2. Confirm the queue has durable pending run records.
3. Confirm the scheduler, not the workflow JSON, owns global active-turn limits.
4. Confirm future workspace capacity is described as usually one active write
   turn per workspace, with possible read-only/sub-workspace lane parallelism
   later.
5. Confirm bulk enqueue returns refs for child workflow instances/runs.

Product-level error cases:

- Bulk enqueue should not start all child workflows at once if active-turn
  capacity is exceeded.
- Fire-and-forget should still return refs so the caller/user can inspect child
  progress later.
- Failed child creation should produce per-item errors, not hide partial batch
  results.

Expected:

- The design supports many queued workflow runs without unbounded memory or
  agent concurrency pressure.

### TEST_CASE_M89_1A — Mock LLM controls workflow happy path end to end

Milestone: `vibe-kanban-vscode-web-450.8`

User story coverage: `USER_STORY_3`, `USER_STORY_5`, `USER_STORY_8`

Steps:

1. Start the Docker qa-mode/mock LLM sandbox.
2. Configure deterministic implementer output.
3. Configure deterministic reviewer output.
4. Launch a workflow from VD UI.
5. Wait for workflow completion.
6. Verify VD workflow state, VK HTTP response reads, webhook inbox/wakeup path,
   and clean presentation page.
7. Record Playwright video and logs.

Product-level error cases:

- If mock LLM script is missing or invalid, test harness should fail before
  product assertions and explain fixture setup.
- If VK completes but VD does not advance promptly, logs should distinguish
  webhook failure from polling fallback.
- If final responses are truncated, clean page should show truncation state.

Expected:

- The E2E uses real VD/VK execution paths with deterministic model output and no
  real provider tokens.
- Tester can reproduce the run from documented commands.

### TEST_CASE_M89_1B — Mock LLM drives invalid XML retry and blocked path

Milestone: `vibe-kanban-vscode-web-450.8`

User story coverage: `USER_STORY_2`, `USER_STORY_6`, `USER_STORY_8`

Steps:

1. Configure mock LLM so a decision turn returns malformed XML.
2. Launch the workflow.
3. Verify the workflow asks the same agent to retry the same decision turn.
4. Configure mock LLM to return valid XML on retry.
5. Verify the workflow advances.
6. Repeat with a fixture that returns malformed XML until retry exhaustion.
7. Verify the workflow reaches the documented needs-attention/blocked behavior.
8. Verify clean presentation/attention UI shows a user-actionable state.

Product-level error cases:

- Invalid XML should not apply a default action.
- Retry prompt should include useful validation feedback.
- Exhaustion should not be a generic crash.
- Duplicate malformed completions should not create duplicate retry prompts.

Expected:

- Product-level XML-decision error behavior is deterministic and covered by
  automated tests.

### TEST_CASE_M89_1C — Mock LLM drives same-state loop then completion

Milestone: `vibe-kanban-vscode-web-450.8`

User story coverage: `USER_STORY_2`, `USER_STORY_3`, `USER_STORY_8`

Steps:

1. Configure mock LLM decision output to choose a same-state loop action such as
   `continueEditing`.
2. Launch the workflow.
3. Verify the workflow returns to the same state with a new state visit.
4. Verify the next agent turn is queued once.
5. Configure the next decision to transition to a different state or terminal
   path.
6. Verify the workflow eventually completes.
7. Inspect timeline/presentation page.

Product-level error cases:

- Same-state loop should not overwrite prior turn/transition history.
- Same-state loop should not create infinite immediate advancement without an
  agent turn completing.
- UI timeline should remain understandable and not show duplicate raw internals.

Expected:

- Same-state loops are durable, visible, and safe under qa-mode E2E.

### TEST_CASE_M89_1D — Independent tester pass records JSON and videos

Milestone: `vibe-kanban-vscode-web-450.8`

User story coverage: `USER_STORY_8`

Steps:

1. After implementation review approval, tester creates a fresh tester bead.
2. Tester reads this approved test plan and onboarding docs.
3. Tester starts a fresh Docker sandbox.
4. Tester runs the required E2E/integration tests.
5. Tester records JSON results keyed by every executed `TEST_CASE_*` ID.
6. Tester records exact commands, URLs, commits, logs, screenshots, videos, and
   cleanup status.
7. Tester removes containers after artifact collection unless the failure plan
   requires keeping them.

Expected:

- Independent tester result is traceable to this plan and roadmap beads.
- Full video artifacts are available for user review.
- No leftover containers remain unless explicitly documented.

## Required committed automated coverage by milestone

### M82

- No implementation code required.
- Docs review by `review4`.
- Optional markdown/link validation if available.

### M83

- Pure Vitest unit tests for workflow-core normalization and advancement.
- No DB/VK/UI required.

### M84

- SQLite-backed VD runtime/store tests.
- Existing workflow runtime/route/webhook tests must remain green.

### M85

- VK Rust service/route tests for any new HTTP read APIs.
- VD client tests for request/response shape and error handling.

### M86

- Pure/core tests for future human step semantics if implemented.
- VD store/API tests for attention items/forms.
- Component or route tests for attention feed.

### M87

- Presentation read-model unit tests.
- React/component/helper tests for clean rendering and hidden debug terms.
- Docker Playwright E2E for clean presentation page.

### M88

- Docs/design tests are sufficient while design-only.
- If unsupported step names are reserved in code, pure-core tests must assert
  V1 rejection with stable unsupported-step error.

### M89

- Docker qa-mode/mock LLM Playwright tests.
- Integration tests that control agent output for happy path, invalid XML retry,
  blocked/needs-attention, and same-state loop behavior.

## Manual-to-E2E conversion notes

Any browser-visible flow in this plan should follow
[`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md):

1. Explore with Playwright CLI.
2. Save transcript artifacts.
3. Generate stable locator hints.
4. Convert to polished Playwright tests.
5. Run focused tests.
6. Do not commit scratch traces/videos unless explicitly approved.

## Tester result format

Implementer and independent tester should record results as JSON comments on the
relevant implementation/tester bead:

```json
{
  "TEST_CASE_M82_1A": { "status": "PASS" },
  "TEST_CASE_M83_1A": { "status": "PASS" },
  "TEST_CASE_M87_1A": {
    "status": "FAIL",
    "notes": "Clean page still shows visible queueItemId text in the timeline."
  }
}
```

Allowed statuses:

- `PASS`
- `FAIL`
- `BLOCKED`
- `SKIPPED_WITH_REASON`

Every `FAIL` or `BLOCKED` result must include:

- exact command or UI step
- observed result
- expected result
- artifact/log path if available
- smallest actionable next fix
