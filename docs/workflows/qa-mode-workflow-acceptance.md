# M89 qa-mode workflow acceptance notes

Milestone: `vibe-kanban-vscode-web-450.8`

## Scope

M89 verifies the workflow branch through the Docker qa-mode / mocked-agent path
without real model tokens. The acceptance suite should exercise real VD and VK
HTTP/browser paths where the branch currently supports them, and use lower-level
integration tests for workflow-core behaviors that are not yet executable through
the durable VD bridge.

## Committed Docker E2E coverage

Run:

```bash
npm run test:e2e:vk-workflows-docker
```

The harness starts the containerized same-origin qa-mode sandbox, resets the
`basic-seeded` fixture, launches VD and VK, and runs:

```bash
npx playwright test --config playwright.vk-workflows-docker.config.ts --output=/tmp/workflow-e2e-logs/playwright-test-results
```

The committed spec `tests/e2e/features/8b79-vd-workflows/two-agent-workflow.spec.ts`
covers:

- `TEST_CASE_M84_1A` — existing two-agent durable workflow still completes.
- `TEST_CASE_M87_1A` — clean workflow presentation happy path.
- `TEST_CASE_M89_1A` — mocked qa-mode output controls the implementer and
  reviewer final responses through real VD/VK execution paths.
- `TEST_CASE_M89_1D` — the Playwright config records full trace and video for
  tester evidence.

The qa-mode response asserted by E2E is:

```text
QA scripted workflow response completed successfully.
```

Both Implementer and Reviewer final responses must include that text in the
presentation read model, proving the clean page is using VK HTTP read models for
actual completed agent turns rather than hard-coded product copy.

## Artifact policy

`playwright.vk-workflows-docker.config.ts` sets:

```ts
trace: 'on'
video: 'on'
```

This intentionally records full tester artifacts for the branch acceptance pass.
The Docker harness writes Playwright artifacts to the host log directory under
`playwright-test-results/` so the container can be removed without losing
videos/traces. Artifacts remain test-run output and should not be committed.

## Lower-level coverage for deferred executable paths

The pure workflow core already has deterministic tests for behaviors that are not
yet exposed by the durable VD bridge as executable XML decision workflows:

- Invalid decision XML retry, retry exhaustion, and `blocked` needs-attention
  status are covered by `TEST_CASE_M83_2B` in
  `packages/workflow-core/test/agent-workflow.test.ts`.
- Same-state loop followed by continued execution is covered by
  `TEST_CASE_M83_2A` in the same test file.
- V1 rejection of unsupported `workflow_call` is covered by `TEST_CASE_M88_1A`.

These cover the engine semantics for `TEST_CASE_M89_1B` and
`TEST_CASE_M89_1C` until a later milestone replaces the legacy two-agent VD
bridge with an executable XML-decision workflow runtime that can be driven by
qa-mode E2E end to end.

## Known acceptance gap

`TEST_CASE_M89_1B` and `TEST_CASE_M89_1C` cannot honestly be full Docker E2E yet
because the durable VD two-agent bridge does not execute the new workflow-core XML
decision contract as the source of truth. Forcing these through E2E now would
create a parallel mocked path rather than testing the real runtime path.

The next implementation milestone that makes XML decision workflows executable
should add Docker qa-mode E2E variants where scripted agent outputs are:

1. malformed XML, then valid XML,
2. malformed XML through retry exhaustion to `blocked`, and
3. same-state loop action, then completion action.
