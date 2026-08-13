# Test Plan 6: E2E coverage for workflow fixtures and VK XML loopback

Branch: `vk/8b79-vd-workflows`

Feature bead: `vibe-kanban-vscode-web-lv2k` — Add E2E coverage for workflow fixtures and VK XML loopback

Related context:

- `test-plan-3.md` — M90-M100 workflow builder/runtime/templates/calls/batches.
- `test-plan-4.md` — M101-M111 workflow UX, monitoring, craft surfaces, provenance, GitHub CI wait.
- `test-plan-5.md` — M113 UX completeness, centralized page, graph/editor follow-ups.
- `src/modules/plugins/workflows/fixtures/workflowStoryFixtures.ts` — current typed Storybook/workflow fixtures.
- `tests/e2e/features/8b79-vd-workflows/workflows-tab.spec.ts` — current browser E2E coverage, mostly API-mocked UI.

## Purpose

Current workflow coverage is strong in two separate layers:

1. **Browser/UI E2E** verifies product pages, modals, graph editor, batches,
   wizard, Storybook, and hidden debug terms with mocked VD API responses.
2. **Core/runtime/server tests** verify XML parsing, invalid XML retries,
   workflow calls, human forms, CI waits, stale observations, and persisted run
   state with mocked queue/observation inputs.

The main gap is the real operational path:

> VD launches or pokes a workflow turn into VK, observes VK session activity,
> reads actual agent message text, extracts/parses XML from that message, and
> advances the workflow so the browser sees the updated run state.

This plan adds an E2E strategy for **each current workflow fixture** and a
scripted VK loopback harness so tests exercise realistic message boundaries
without depending on nondeterministic LLM output.

## Non-goals

- Do not require a real LLM model for deterministic CI.
- Do not require GitHub network calls; GitHub CI status remains mocked/scripted.
- Do not create new workflow runtime semantics.
- Do not use arbitrary bash command steps to drive tests.
- Do not expose raw XML, queue IDs, webhook details, response refs, or internal
  trigger terms in normal product UI.
- Do not replace lower-level workflow-core/runtime tests; this plan complements
  them with end-to-end wiring coverage.

## Fixture inventory and expected E2E representation

| Fixture / story shape | Source fixture | Primary E2E type | Real loopback needed? | Why |
| --- | --- | --- | --- | --- |
| Simple agent workflow | `simpleAgentWorkflowDefinition()` | Launch + scripted XML completion | Yes | Baseline end-to-end agent turn and XML decision parse. |
| Dev / Review / Tester | `devReviewTesterWorkflowDefinition()` | Launch + multi-role loop + completion | Yes | Main real-world workflow path with loops and multiple VK sessions. |
| Human approval workflow | `humanFormWorkflowDefinition()` | Launch + human form + agent decision | Partial | Human form submission is VD UI; final agent decision should use VK XML loopback. |
| Blocking workflow call | `workflowCallDefinition()` | Parent/child launch + child completion | Yes | Verifies durable parent waits on exact child run and resumes. |
| GitHub CI wait | `githubCiWaitWorkflowDefinition()` | Agent XML produces CI watch + poll completion | Yes | Verifies XML fields feed `waitFor github_ci` and UI updates without webhooks. |
| Dense transition graph | `denseTransitionWorkflowDefinition()` | Graph/editor/browser visual E2E | No runtime loopback required | Stress fixture is for graph readability; runtime semantics are covered by core shapes. |
| Invalid graph | `invalidWorkflowDefinition()` | Editor validation E2E | No | Must fail product-level validation without crashing. |
| Workflows home | `workflowsHomeFixture()` | Browser dashboard E2E | No | Read-model/UI state coverage. |
| Run presentation waiting/completed CI | `runningCiPresentationFixture()`, `completedWorkflowPresentationFixture()` | Browser presentation E2E plus live loopback result | Partial | Read-model rendering stays mocked; at least one live loopback should prove real run updates presentation. |
| Batch detail/home batch | `workflowsHomeFixture().recentBatches` and batch fixtures in E2E | Browser/API E2E | Partial | Batch launch can be mocked for UI; one server integration should prove queued items launch real runs. |

## Recommended test architecture

### 1. Keep current mocked browser E2E tests

The existing Playwright tests are valuable because they are fast, deterministic,
and catch UI regressions. Keep them as the browser contract for product copy,
accessibility locators, hidden debug terms, and modal/editor interactions.

### 2. Add a scripted VK loopback harness

Create a deterministic harness that behaves like VK at the boundaries VD cares
about:

- sessions can be listed/created/read,
- queued follow-up messages are captured,
- activity/latest-response endpoints expose scripted completed responses,
- response bodies contain realistic agent message text, including XML embedded
  in normal prose/code fences,
- queue/provenance/source fields behave like VK enough to catch request-shape
  regressions.

This can be implemented as one of:

1. **In-process fake VK HTTP server** for VD server/runtime integration tests.
2. **Docker E2E scripted VK executor mode** if VK already has or can accept a
   deterministic executor/test mode.
3. **Playwright route-backed API harness** only for browser presentation checks,
   not for scanner/runtime loopback.

Preferred first implementation: **in-process fake VK HTTP server + real VD
runtime/scanner path**. It is deterministic and closer to real HTTP/message
boundaries than directly calling `completeAgentTurn()`.

### 3. Use actual fixture definitions to seed runnable designs

Fixtures should be imported from `workflowStoryFixtures.ts` or moved to a shared
fixture module if production/test import boundaries require it. The E2E harness
should not duplicate workflow definitions inline.

### 4. Script responses as realistic messages, not just raw XML strings

For real-world confidence, scripted VK responses should include variants like:

```text
I finished the implementation and reviewed it.

<decision action="ready_for_review">
  <summary>Implemented the requested feature.</summary>
  <concerns>No known concerns.</concerns>
</decision>
```

and:

````text
Here is the final workflow decision:

```xml
<decision action="approved">
  <remarks>Looks good.</remarks>
</decision>
```
````

The scanner/runtime should process the actual message body in the same shape it
would receive from VK latest-response APIs.

### 5. Separate deterministic loopback from real model smoke

The required CI path should use scripted deterministic XML. A later optional
manual/nightly smoke can use a real executor/model, but that should not gate
normal development because model output is nondeterministic.

## Acceptance cases

### TEST_CASE_LV2K_1A — Current fixture inventory is test-addressable

Steps:

1. Import or enumerate all current workflow fixtures from
   `workflowStoryFixtures.ts`.
2. Assert every graph/runtime fixture has an explicit E2E mapping in this test
   plan or a checked-in fixture registry.
3. Assert no Storybook-only fake schema shape is used for runtime E2E.

Expected:

- Simple, DRT, human form, workflow call, GitHub CI wait, dense transition,
  invalid graph, home, run presentation, and batch shapes are accounted for.
- Runtime-capable fixtures validate through workflow graph/core validation.

Validation:

- Unit test over fixture registry.
- `npm run check-types`.

### TEST_CASE_LV2K_2A — Simple agent workflow loopback parses actual VK XML message

Steps:

1. Seed/publish `simpleAgentWorkflowDefinition()` as a runnable design.
2. Launch a run with `featureRequest` input and a role binding to a scripted VK
   session.
3. Verify VD queues the initial agent turn through the VK queue endpoint.
4. Script VK latest-response to return a completed message containing prose plus
   XML decision:
   `<decision action="done"><summary>Finished simple task.</summary></decision>`.
5. Run the scanner/poller path that observes VK responses.
6. Open/read the run presentation.

Expected:

- Run reaches completed status.
- Parsed `summary` is available in workflow transition/output/history as
  product data.
- Browser presentation shows completed run/product summary.
- Normal UI does not show raw XML, response refs, queue item, webhook, trigger,
  delivery ID, or `WorkflowStepState`.

Validation:

- Server/integration test for launch -> VK queue -> latest-response -> advance.
- Browser assertion for final presentation.

### TEST_CASE_LV2K_2B — Dev / Review / Tester loopback covers multi-role handoff and loops

Steps:

1. Seed/publish `devReviewTesterWorkflowDefinition()`.
2. Launch with Dev/Review/Tester role bindings mapped to distinct scripted VK
   sessions.
3. Script Dev implement non-decision completion.
4. Script Dev self-review XML:
   `ready_for_review` with `summary`.
5. Assert Review turn is queued to Review session and prompt includes Dev
   handoff/summary.
6. Script Review XML `changes_requested` with `requestedChanges`.
7. Assert workflow loops back to Dev and queues Dev implement again.
8. Script Dev fix, Dev self-review, Review `approved`, Tester `bug_found`, Dev
   fix, Review `approved`, Tester `approved`.
9. Open/read run presentation.

Expected:

- Each role receives turns in the correct session.
- Same-state/loop history is visible as product timeline entries.
- Parsed XML result fields drive handoffs.
- Duplicate scanner observations do not enqueue duplicate turns.
- Final state is completed only after Tester approved.

Validation:

- Integration test with scripted VK latest responses per session.
- Browser run page asserts Dev/Review/Tester timeline and no debug terms.

### TEST_CASE_LV2K_2C — Human form fixture resumes from UI submission then XML decision

Steps:

1. Seed/publish `humanFormWorkflowDefinition()`.
2. Launch workflow.
3. Assert run waits on human form/attention item.
4. Submit the form through the product UI or route with `approved: true`.
5. Assert the next agent decision turn is queued to VK.
6. Script VK response with XML decision `<decision action="done" />`.
7. Run scanner/poller and open presentation.

Expected:

- Human attention appears in Workflows home/run page.
- Submitting form resumes workflow exactly once.
- Agent prompt includes submitted human value.
- Run completes after scripted XML decision.
- Duplicate form submission/duplicate scanner observation are idempotent.

Validation:

- Browser E2E for form attention and submit.
- Integration assertion for queued prompt and final state.

### TEST_CASE_LV2K_2D — Blocking workflow call fixture launches child and resumes parent

Steps:

1. Seed/publish parent fixture from `workflowCallDefinition()` and a compatible
   child workflow design/version.
2. Launch parent run.
3. Assert child run is created and parent enters waiting state with exact
   `childRunId`.
4. Complete child through scripted VK XML path.
5. Deliver child completion observation to parent.
6. Also deliver a stale/wrong-child completion observation.
7. Open parent run presentation.

Expected:

- Parent ignores mismatched `childRunId` observations.
- Parent resumes only after the expected child completes.
- Parent prompt includes `child.<stepId>.childStatus`, output ref, and child run
  reference where product-appropriate.
- Presentation shows parent/child call tree and child link without raw IDs by
  default beyond product links.

Validation:

- Runtime integration with persisted runs.
- Browser presentation assertion for child call tree.

### TEST_CASE_LV2K_2E — GitHub CI wait fixture observes XML CI fields and polling result

Steps:

1. Seed/publish `githubCiWaitWorkflowDefinition()`.
2. Launch run with Dev and Review sessions.
3. Script Dev VK response containing prose plus XML:
   `<decision action="wait_for_ci"><summary>Pushed branch.</summary><ciRunId>12345</ciRunId><repo>acme/repo</repo><sha>def456</sha></decision>`.
4. Run scanner/poller and assert workflow enters GitHub CI wait state.
5. Script GitHub CI poller result as pending, then success.
6. Assert Review turn is queued after success.
7. Script Review approval XML and complete workflow.
8. Open run page.

Expected:

- CI watch is created from parsed XML fields.
- No webhook is required.
- Pending state appears as product-level "Waiting for GitHub CI".
- Success resumes workflow; failure variant blocks/resumes with useful detail.
- Browser presentation hides raw transport/debug terms.

Validation:

- Integration test with fake VK + fake GitHub CI client.
- Browser run presentation assertion.

### TEST_CASE_LV2K_2F — Invalid XML and model-formatting quirks are covered at VK message boundary

Steps:

1. Launch a decision workflow through the loopback harness.
2. Return VK message text variants:
   - no XML,
   - malformed XML,
   - unknown action,
   - missing required field,
   - valid XML inside markdown code fence,
   - valid XML with prose before/after,
   - multiple XML blocks where one is invalid and one is valid,
   - huge XML/body triggering configured truncation behavior.
3. Run scanner/poller after each response.

Expected:

- Invalid responses trigger configured retry prompts.
- Retry prompts are queued to the same role/session.
- Exhaustion blocks with product-level reason.
- Valid fenced/prose-surrounded XML advances correctly if supported by parser.
- Unknown/missing fields produce stable validation errors.
- Raw XML is not shown in default run presentation.

Validation:

- Server integration test around scanner/runtime boundary.
- Existing workflow-core tests remain authoritative for parser edge cases; this
  E2E proves the message boundary uses them.

### TEST_CASE_LV2K_3A — Dense transition graph fixture has browser visual coverage

Steps:

1. Open the graph editor or Storybook story for `denseTransitionWorkflowDefinition()`.
2. Verify state nodes are visible and labels are readable.
3. Verify transition/action labels have dark backgrounds, wrap/truncate long
   text, and are above/near edges.
4. Click a dense transition label.
5. Use keyboard focus/Enter/Space on a transition label if accessible.
6. Inspect side pane.

Expected:

- Transition/action label is selectable and visibly selected.
- Side pane shows source -> target, action label, target state, result fields,
  wait/provider details when present, and handoff prompt where present.
- Reset layout restores the computed layout.
- Runtime workflow JSON is not mutated by view-local dragging.

Validation:

- Existing Storybook walkthrough plus Playwright graph-editor test.
- Screenshot/video artifact required.

### TEST_CASE_LV2K_3B — Invalid graph fixture fails visibly but safely

Steps:

1. Open editor/story using `invalidWorkflowDefinition()`.
2. Confirm graph still renders if possible.
3. Confirm validation panel shows product-level invalid target-state issue.
4. Attempt Save/Publish if UI allows.

Expected:

- Save/Publish is disabled or fails with product-level validation.
- No crash/blank pane.
- No raw stack traces or debug internals.

Validation:

- Browser/component E2E.

### TEST_CASE_LV2K_4A — Workflows home fixture remains covered by browser E2E

Steps:

1. Render Workflows home using `workflowsHomeFixture()` or equivalent API
   read-model fixture.
2. Assert sections:
   - summary tiles,
   - Needs input,
   - Active/recent runs,
   - Your workflows,
   - Starter templates,
   - Recent batches.
3. Assert CTAs only appear when supported.
4. Assert product copy explains waiting/next action.

Expected:

- No debug/transport terms.
- Direct route and React craft surface both work.
- Starter templates do not show Run/Batch.

Validation:

- Existing Playwright Workflows tab spec, updated to use shared fixture where
  practical.

### TEST_CASE_LV2K_4B — Run presentation fixtures cover waiting and completed CI states

Steps:

1. Open run presentation for `runningCiPresentationFixture()`.
2. Assert current owner/status, CI waiting reason, timeline, provenance, and no
   debug terms.
3. Open run presentation for `completedWorkflowPresentationFixture()`.
4. Assert completed CI result, Review timeline, outputs/artifacts.

Expected:

- Product summary tells who has the ball and what happens next.
- Raw XML/response refs/queue/webhook terms stay hidden.

Validation:

- Browser E2E with mocked presentation API.
- At least one live loopback test from TEST_CASE_LV2K_2E should prove real run
  state can produce the presentation model.

### TEST_CASE_LV2K_4C — Batch fixture coverage includes item errors and linked runs

Steps:

1. Queue batch from browser using JSON-lines items.
2. Include at least one valid item and one invalid item.
3. Open batch detail.
4. Use filters for All/Pending/Running/Complete/Failed-blocked.
5. Click linked run for a launched item.

Expected:

- Per-item errors and field errors are visible.
- Pending items explain capacity/backpressure.
- Retry/Cancel controls remain absent unless implemented later.
- Launched items link to run pages.

Validation:

- Existing browser E2E plus a server integration proving batch item launches can
  feed the same loopback runtime path as single launches.

## Harness design details

### Fake VK API behavior

The fake VK server should implement the minimum real endpoints used by VD:

- `GET /api/sessions?workspace_id=...`
- `POST /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/sessions/:sessionId/queue`
- activity/latest-response endpoints used by `workflow-session-scanner`
- optional process kill/follow-up endpoints only if required by current client

It should record:

- queued messages,
- source/provenance fields,
- session id,
- workspace id,
- dedupe/idempotency keys if present,
- execution process ids and completed timestamps.

It should allow tests to script:

- next response per session,
- response completion timestamp,
- execution process id,
- response body/message text,
- running/queued/idle activity state.

### XML message corpus

Store reusable scripted messages in a fixture module, for example:

```txt
src/modules/plugins/workflows/e2e-fixtures/workflowXmlMessages.ts
```

Suggested helpers:

- `xmlDecision(action, fields)`
- `proseWrappedXml(xml)`
- `fencedXml(xml)`
- `malformedXml(action)`
- `unknownActionXml()`
- `missingRequiredFieldXml(action)`

### Browser strategy

Use browser E2E for product surfaces, not every scanner detail:

- one browser smoke per fixture category,
- one live loopback browser assertion for completed simple/DRT/CI wait path,
- Storybook/browser capture for dense graph visuals,
- API/component tests for exhaustive invalid XML corpus.

### Flake controls

- Avoid real LLMs in required tests.
- Avoid network GitHub calls; use fake GitHub CI client.
- Use deterministic clocks where persisted scanner ordering depends on time.
- Make scanner invocation explicit rather than waiting for long intervals.
- Verify idempotency by replaying the same latest-response observation.

## Proposed implementation sequence

### LV2K-A — Fixture registry and test harness design

Scope:

- Add a registry that maps current fixtures to required E2E coverage.
- Add docs/comments for which fixtures are runtime-capable vs UI-only.
- No runtime behavior change.

Validation:

- Fixture registry unit test.
- `npm run check-types`.

### LV2K-B — Fake VK loopback server/client harness

Scope:

- Build deterministic fake VK HTTP server or in-process client harness.
- Exercise actual VD VK client/scanner boundary, not direct runtime completion.

Validation:

- Server tests for queue -> latest-response -> scanner classification.
- Verify request/response shapes match current VK client expectations.

### LV2K-C — Simple + DRT loopback E2E

Scope:

- Launch simple and DRT workflows through persisted runtime/API.
- Script XML responses through fake VK latest-response path.
- Verify queued prompts, parsed fields, loops, completion, presentation.

Validation:

- Integration tests.
- Optional browser run-page assertion for final DRT timeline.

### LV2K-D — Human form + workflow call loopback E2E

Scope:

- Human form attention/submission plus agent XML resume.
- Parent/child workflow-call launch/wait/resume with stale child check.

Validation:

- Integration tests plus browser presentation assertions.

### LV2K-E — GitHub CI wait loopback E2E

Scope:

- Agent XML creates CI wait from actual message body.
- Fake GitHub CI poller pending/success/failure.
- Review turn resumes after success.

Validation:

- Integration tests plus browser presentation assertion.

### LV2K-F — Browser/Storybook fixture parity pass

Scope:

- Ensure every UI-only fixture has a browser or Storybook walkthrough path.
- Dense graph visual artifact.
- Home/run/batch fixture coverage remains current.

Validation:

- Playwright product spec.
- Storybook build/walkthrough.
- Screenshots/video artifacts.

## Review checklist

Reviewer should confirm:

- Tests exercise actual VK client/scanner/message boundary where claimed.
- Scripted XML is in realistic message bodies, not only direct runtime arguments.
- Every current fixture has an explicit coverage path.
- UI tests still hide debug/transport terms by default.
- No real LLM/GitHub/network dependency is required for required CI tests.
- No new runtime semantics were added solely for testing.

## Tester handoff checklist

Tester should record:

- commands run,
- whether Docker/browser tests ran or were list-only,
- fake VK harness logs/artifacts,
- representative queued message text,
- representative latest-response body containing XML,
- final workflow status and timeline assertions,
- screenshots/video for browser-visible fixture coverage.

Minimum tester commands after implementation:

```bash
npm run test -- \
  src/modules/plugins/workflows/server/persistedWorkflowRuntime.test.ts \
  src/server/workflow-session-scanner.test.ts \
  src/server/vk-client.test.ts

npm run check-types

npx playwright test --config playwright.vk-workflows-docker.config.ts \
  tests/e2e/features/8b79-vd-workflows/workflows-tab.spec.ts --list

git diff --check
```

If browser-visible fixture coverage changed, tester should also run the relevant
Docker Playwright or Storybook walkthrough command and save artifacts.
