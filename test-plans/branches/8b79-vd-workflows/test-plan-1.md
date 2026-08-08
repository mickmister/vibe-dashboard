# Test Plan 1: Durable workflow UI and webhook-driven qa-mode execution

Branch: `vk/8b79-vd-workflows`

Related onboarding docs:

- [`../../onboarding/feature-work-process.md`](../../onboarding/feature-work-process.md)
- [`../../onboarding/implementer-testing-process.md`](../../onboarding/implementer-testing-process.md)
- [`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md)
- [`../../onboarding/vk-mocked-sandbox.md`](../../onboarding/vk-mocked-sandbox.md)

## User story

As a user/overseer working in VD, I want to configure and launch durable agent
workflows from the UI so that I can kick off multi-agent work, stop manually
orchestrating each agent turn, and trust the system to advance the workflow,
notify me, and show progress/results reliably.

For the initial complete feature, the primary workflow is a two-agent review
round:

1. User configures or selects a declarative workflow definition in VD.
2. User chooses or creates the relevant VK sessions/roles.
3. User starts the workflow from VD UI.
4. VD queues the first agent turn through VK.
5. VK executes the agent using real execution paths, with qa-mode/scripted mocks
   available for tests.
6. When VK sees a terminal execution event, VK emits a generic signed webhook.
7. VD receives the webhook, verifies HMAC, dedupes it, stores an inbox record,
   and wakes `runReady()`.
8. VD advances the durable workflow idempotently.
9. VD pipes source output to reviewer when appropriate.
10. VD waits for reviewer completion.
11. VD completes the workflow and notifies the overseer/session.
12. VD shows a workflow run timeline/status page with current step, waits,
    queue/session refs, errors, and final output refs.
13. The whole flow is verified by Docker-based qa-mode E2E plus a Playwright E2E
    test.

## Constraints and decisions

- VK remains generic and does not know about VD.
- VK exposes HTTP APIs for generic webhook subscription management.
- VK supports multiple user-configurable webhook subscriptions.
- VD self-provisions one localhost HMAC webhook subscription automatically and
  retries in the background when VK is not ready.
- No webhook-related Docker env vars are required for the default same-container
  setup.
- Webhook URLs are localhost/private-only by default unless explicitly allowed.
- Webhooks are best-effort wakeups. VD polling remains the idempotent correctness
  backstop.
- v0 webhook events are terminal execution events only.
- Webhook payloads store refs/metadata only and are HMAC signed.
- Official workflow E2E runs in Docker/containerized development environment,
  not directly on the host.
- Stall auto-nudge sends exactly `Please continue.`.
- Agent turns that start a workflow or callback should not count as stalled.

## Prerequisites and sandbox setup

Sandbox startup is a prerequisite for this plan, not a product test case. If the
sandbox cannot start, record the blocker on the implementation/tester bead and
fix the environment or harness before evaluating product behavior.

Prerequisite steps:

1. Start the Docker/containerized qa-mode workflow sandbox agreed for this
   branch.
2. Ensure the sandbox starts VD, VK, VK qa-mode/scripted execution support, and
   the front-door route needed for browser testing.
3. Record the VD URL, VK API base, sandbox/container id, fixture variant, and
   cleanup command.
4. Confirm VK can execute qa-mode/scripted agent turns without real
   model-provider tokens.
5. Confirm no test commands for official workflow E2E are running directly on
   the local host outside the containerized environment.

Expected prerequisite state:

- VD and VK are reachable.
- The sandbox exposes enough logs/status to debug failures.
- The tester can cleanly stop the sandbox using the documented cleanup command.

## Agent-driven browser workflow

Use Playwright CLI for exploratory browser testing and convert the final passing
flow into a committed Playwright E2E test.

```bash
PW_SESSION="vd-workflows-$(date +%Y%m%d%H%M%S)"
pnpm playwright:cli -s="$PW_SESSION" open "$VD_URL"
pnpm playwright:cli -s="$PW_SESSION" resize 1280 900
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

For every important interaction, capture a fresh snapshot, interact using the
latest ref, generate a stable locator hint, and record commands/artifacts on the
implementation or tester bead. Committed E2E tests must use stable locators, not
transient refs.

## Product test cases

### TEST_CASE_1A — Verify VD/VK API and route health

Steps:

1. Open the VD URL with Playwright CLI.
2. Verify the VD app shell renders.
3. Verify `/dashboard/api/*` routes return JSON and are not intercepted by SPA
   fallback.
4. Verify VD can reach VK APIs through the configured server-to-server or
   same-origin route.

Product-level error cases:

- If a dashboard API route is intercepted by SPA fallback, the UI should show a
  specific route/API configuration error rather than a generic `Something went
  wrong` message.
- If VK is unreachable, workflow UI should show `VK is unreachable` with the
  configured VK base URL, retry affordance, and enough detail for the user to
  distinguish VK-down from validation failure.
- If an API returns malformed/non-JSON data, the UI should fail fast with a
  route/protocol error and should not attempt to launch a workflow.

Expected:

- VD UI renders without fatal browser console errors.
- Workflow APIs are reachable.
- VK APIs needed by workflow launch, queueing, response read, and webhook
  subscription setup are reachable.
- Product-level failures are specific, actionable, and do not collapse into a
  generic error state.

### TEST_CASE_2A — VD self-provisions VK webhook subscription

Steps:

1. Start VD with no existing webhook provisioning state.
2. Allow VD startup/background provisioner to contact VK.
3. Inspect VD workflow/webhook status API or UI.
4. Inspect VK generic webhook subscription API.

Product-level error cases:

- If VK is unavailable during VD startup, VD should show provisioning as
  `waiting for VK` or `retrying`, not failed forever.
- If the stored subscription id exists but VK no longer has that subscription,
  VD should repair/recreate exactly one subscription and report that repair.
- If VD cannot persist its generated secret/subscription state, it should report
  a durable-storage error and should not create a new subscription on every
  restart.
- If the VK upsert API returns a validation error, VD should show the specific
  invalid field/reason.

Expected:

- VD generates/stores an HMAC secret and localhost callback URL.
- VD creates or upserts exactly one named VK webhook subscription.
- Restarting VD does not create duplicate VK subscriptions.
- If VK is initially unavailable, VD retries in the background and eventually
  provisions once VK is reachable.
- Users/operators can tell whether webhook provisioning is healthy, retrying,
  repaired, or blocked.

### TEST_CASE_2B — VK rejects unsafe webhook subscription URLs by default

Steps:

1. Attempt to create/update a VK webhook subscription with a non-local external
   URL while localhost-only/default-private policy is active.
2. Attempt to create/update a VK webhook subscription with the VD localhost URL.

Product-level error cases:

- Rejected external URL should identify the URL policy, the rejected host, and
  the setting/override needed to allow external URLs.
- Invalid URL syntax should be caught before storing the subscription.
- Duplicate subscription names/keys should update the intended subscription or
  return a clear conflict; they should not create ambiguous duplicates.
- Missing/empty HMAC secret should be rejected with a specific validation error.

Expected:

- External URL is rejected with a clear validation error.
- Localhost/private allowed URL is accepted.
- VK behavior remains generic and does not contain VD-specific concepts.
- Invalid subscription inputs fail fast and are not partially stored.

### TEST_CASE_3A — User opens workflow configuration UI

Steps:

1. Open the workflow area in VD.
2. Locate available workflow definitions.
3. Select the built-in or saved `two-agent-review-round` definition.
4. View definition details including inputs, policies, and target roles.

Product-level error cases:

- If no definitions are available, the UI should explain that no workflow
  definitions are active and offer a route to add/import/restore built-ins.
- If a definition is invalid, disabled, or has a schema version the runtime does
  not support, the UI should show a specific validation/version error and block
  launch.
- If definition loading fails, the UI should preserve the page, show retry, and
  not lose any draft run inputs.

Expected:

- User can discover/select a workflow definition without editing raw code.
- UI explains required inputs and role/session requirements.
- UI clearly shows whether the definition is active/valid.

### TEST_CASE_3B — User configures workflow run inputs

Steps:

1. Choose or create source/implementer and reviewer sessions/roles.
2. Enter a task/prompt.
3. Choose optional overseer notification/session behavior.
4. Submit invalid/missing fields first.
5. Correct the inputs.

Product-level error cases:

- Missing required task/prompt should show an inline required-field error and
  should not create a workflow instance.
- Same source/reviewer session should be blocked before queueing with a clear
  `source and reviewer must be different sessions` error.
- A selected session from the wrong workspace should show which session is
  invalid and what workspace was expected.
- Auto-create failure should report whether VK session creation failed, role
  resolution failed, or storage/binding persistence failed.
- If reviewer/source role names do not exist, the UI should explain whether it
  will auto-create a session or require a different role/session choice.

Expected:

- Required-field validation is clear.
- Same-session source/reviewer selection is blocked.
- Auto-created/reused sessions are visible before launch.
- Corrected inputs can be submitted successfully.
- Invalid submissions fail before any queue side effect whenever possible.

### TEST_CASE_4A — User launches durable two-agent workflow from UI

Steps:

1. Click the workflow launch action.
2. Observe the immediate confirmation that the workflow has started.
3. Record workflow instance/run id and status URL.
4. Confirm the UI indicates the overseer can leave/end their turn.

Product-level error cases:

- If VK queueing fails before acceptance, the UI should show a retryable queue
  error and the workflow should not appear falsely running.
- If VK accepts the queue but VD cannot record the queue ref, the UI/status
  should surface a possible-recovery/possible-duplicate warning rather than
  hiding the hard edge.
- Double-clicking launch or browser retry should not create duplicate workflow
  instances or duplicate source queue items.
- If the workflow is paused/cancelled during launch, status should explain the
  state and avoid further queueing.

Expected:

- Launch returns promptly; the UI does not rely on a long-lived browser/client
  process to own the wait.
- Source agent prompt is queued through VK.
- Workflow status shows the source wait step.
- No direct `/follow-up` bypass is used.

### TEST_CASE_5A — Source qa-mode agent completes and webhook wakes VD

Steps:

1. Let the scripted/qa-mode source agent complete.
2. Observe VK terminal execution event emission.
3. Observe VD webhook inbox receives a signed event.
4. Observe VD wakes `runReady()` without manual `workflow run-once`.
5. Confirm the workflow advances to reviewer handoff.

Product-level error cases:

- If webhook delivery is missed, polling should eventually advance the workflow
  and status should not show a permanent stuck state.
- If the source response is missing or unreadable, the status UI should show a
  response-read error and should not queue reviewer work with empty content.
- If the response is truncated and policy blocks truncation, the workflow should
  show a blocked/truncated-source state with a clear next action.
- If reviewer queueing fails, status should show a retryable reviewer-handoff
  error and should not lose the source response ref.

Expected:

- VD verifies HMAC and stores one inbox row.
- VD dedupes by webhook delivery id or stable fallback key.
- VD pipes source output to reviewer and creates reviewer wait.
- Polling remains enabled but is not required for this happy-path advancement.

### TEST_CASE_5B — Duplicate and invalid webhook handling

Steps:

1. Re-deliver the same terminal webhook payload.
2. Deliver a payload with invalid HMAC/timestamp.
3. Confirm workflow state after each case.

Product-level error cases:

- Duplicate valid webhook should be acknowledged without queuing reviewer or
  notification a second time.
- Invalid HMAC should return an auth error and should not insert an inbox row or
  wake the runtime.
- Expired timestamp/replay outside tolerance should be rejected with a clear
  replay/timestamp error.
- Unknown event type should be stored or rejected according to policy with a
  specific reason, not treated as a successful workflow signal.
- Delivery id missing should either be rejected or deduped by stable hash, and
  the behavior should be visible in logs/status.

Expected:

- Duplicate valid webhook is acknowledged but does not duplicate reviewer queue,
  notifications, or workflow state transitions.
- Invalid signed webhook is rejected and does not mutate workflow state.
- Polling can still advance a legitimate missed event later.

### TEST_CASE_6A — Reviewer qa-mode agent completes and workflow notifies overseer

Steps:

1. Let the scripted/qa-mode reviewer agent complete.
2. Observe VK terminal execution webhook and VD inbox row.
3. Observe VD wakes `runReady()` and completes the workflow.
4. Check the overseer/session notification.

Product-level error cases:

- If reviewer execution fails/kills, workflow status should show reviewer failed
  and should not mark the round completed successfully.
- If overseer notification queueing fails before acceptance, status should show
  a retryable notification error.
- If the notification was accepted but completion recording fails, retry should
  not send duplicate notification and status should explain recovery.
- If overseer session has an active callback/CI wait, notification should wait
  and status should explain why notification is delayed.

Expected:

- Workflow completes idempotently.
- Notification is queued exactly once.
- Notification includes enough information for the overseer to understand the
  source/reviewer outcome and find workflow/session refs.
- Durable workflow state remains refs/metadata oriented according to current
  storage policy.

### TEST_CASE_7A — Workflow run timeline/status is useful

Steps:

1. Open the workflow run timeline/status UI.
2. Inspect steps, current/terminal status, queue refs, session links, webhook
   inbox/wakeup state, errors, and final output refs.
3. Refresh the page.

Product-level error cases:

- If timeline data partially fails to load, the UI should show which section is
  unavailable rather than blanking the whole run page.
- If a queue/session/execution ref is missing, the UI should label it missing
  and keep other refs visible.
- If a step has a stored error, the UI should show the step, status, concise
  message, and technical details/refs separately.
- Refreshing during a wait should not reset local state to a misleading idle or
  completed state.

Expected:

- Timeline survives refresh and is backed by durable state.
- User can understand what happened without inspecting logs.
- Links to relevant VK sessions/queue/execution refs are available.

### TEST_CASE_8A — Failure, callback, and stall behavior

Steps:

1. Run scripted source/reviewer outcomes for failed/killed execution.
2. Run scripted callback/wait outcome.
3. Run scripted stall/no-final-response outcome.

Product-level error cases:

- Failed/killed source turn should become a visible workflow attention/failure
  state and should not queue reviewer work as if a valid response existed.
- Failed/killed reviewer turn should preserve source output refs and explain
  reviewer failure.
- Callback/CI wait should show waiting-on-external state and should not consume
  execution budget or get auto-nudged as a stall.
- A turn that starts another workflow should not be classified as stalled merely
  because the current agent ended its turn.
- A no-final-response stall should auto-nudge with exactly `Please continue.`;
  if the nudge cap is reached, status should show attention and stop looping.

Expected:

- Failed/killed terminal events do not satisfy response-piping triggers as a
  successful response.
- Callback/workflow-start cases do not count as stalled.
- Stall detection auto-nudges with exactly `Please continue.`.
- Nudge behavior is capped/observable and does not loop indefinitely.

### TEST_CASE_9A — Convert approved browser flow into committed Playwright E2E

Steps:

1. Save Playwright CLI transcript/artifacts from the passing manual flow.
2. Convert the transcript into a polished Playwright spec under
   `tests/e2e/features/8b79-vd-workflows/`.
3. Use stable semantic locators and `frameLocator` where needed.
4. Run the focused E2E test.

Expected:

- The committed E2E proves the confirmed user story.
- Test does not contain transient Playwright CLI refs.
- Test runs against Docker/containerized qa-mode setup.

### TEST_CASE_10A — Independent tester pass

Steps:

1. After implementation review approval, create a fresh tester bead.
2. Give the tester the independent tester onboarding doc and this approved test
   plan.
3. Tester runs the plan literally in a fresh Docker/containerized sandbox.
4. Tester records JSON results keyed by these `TEST_CASE_*` ids.

Expected:

- Independent tester either confirms the flow or reports concrete blockers with
  artifacts.
- Feature is not considered fully accepted until implementer E2E and independent
  tester pass, or deferrals are explicitly approved.
