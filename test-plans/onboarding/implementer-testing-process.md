# Implementer testing process

Use this process when implementing a feature, bug fix, or refactor that must be
validated before review and independent testing.

Implementers own first-pass correctness. Independent tester agents provide a
separate double-entry verification layer; they should not be the first time a
browser-visible flow is exercised.

## Core policy

Implementers must validate their own work before requesting review.

For browser-visible work, assume E2E coverage is required. Create or update an
E2E test unless E2E is not relevant to the work being created. If unsure whether
E2E is necessary, ask the user directly before skipping it.

E2E tests are assumed to be slow. Do not optimize the process by avoiding E2E
coverage; organize tests so focused feature runs are easy and full reverification
can happen later.

## What implementers are responsible for

During implementation, the implementer should:

1. Track the work in `bd`.
2. Practice TDD when practical.
3. Add or update the lowest useful automated tests.
4. Use `pnpm playwright:cli` for browser-visible behavior.
5. Add or update Playwright E2E coverage for browser-visible work unless E2E is
   not relevant.
6. Run focused validation before requesting review.
7. Record commands, results, URLs, screenshots, and deviations on the
   implementation or QA bead.

## Choosing the right test level

Use the lowest test level that proves the behavior, then add E2E for
browser-visible behavior.

| Work type | Expected validation |
| --- | --- |
| Pure logic or data transformation | Unit test first. |
| Springboard action/state behavior | Focused action or integration test. |
| Browser-visible UI behavior | Playwright CLI smoke plus Playwright E2E. |
| VD navigation, persistence, mobile layout, or iframe behavior | Playwright E2E. |
| VD ↔ VK integration or model-provider-like flow | Mocked VK sandbox manual pass plus Playwright E2E unless E2E is not relevant. |
| Docs-only change | Review rendered/linked docs; E2E is usually not relevant. |

If browser-visible behavior changes, lower-level tests do not replace E2E. They
make E2E easier to debug and keep focused.

## TDD workflow

Prefer this loop:

1. Reproduce the issue or identify the behavior gap.
2. Write the smallest failing test that captures the behavior when practical.
3. Implement the smallest correct change.
4. Run the focused test.
5. Add browser/E2E coverage for user-visible behavior.
6. Run the approved manual plan or the relevant subset.
7. Review your own diff and validation evidence before handoff.

When TDD is not practical, state why in the handoff and compensate with a
focused manual browser pass plus durable E2E coverage when browser behavior is
involved.

## Browser-visible change workflow

For browser-visible work, use the repo-pinned Playwright CLI wrapper:

```bash
PW_SESSION="<feature>-$(date +%Y%m%d%H%M%S)"

pnpm playwright:cli -s="$PW_SESSION" open "$URL"
pnpm playwright:cli -s="$PW_SESSION" resize 1280 720
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

Use snapshots and refs to drive the UI, then generate locator hints for the E2E
test:

```bash
pnpm playwright:cli -s="$PW_SESSION" generate-locator e<N> --json
```

Follow [`playwright-manual-to-e2e.md`](./playwright-manual-to-e2e.md) whenever
the manual pass should become committed E2E coverage.

## E2E is default-on for browser work

Create or update Playwright E2E coverage for:

- new browser-visible features
- bug fixes for browser-visible behavior
- regressions found by manual testing
- routing, URL, persistence, or restore behavior
- mobile or constrained viewport behavior
- iframe behavior
- VD/VK integration behavior
- model-provider-like paths that can run through mocks or `qa-mode`

Do not skip E2E because it is slow. Assume E2E is slow and organize it so it can
be run intentionally.

E2E can be skipped only when it is not relevant to the work, such as:

- docs-only changes
- pure internal logic with no browser-visible path
- test harness or configuration work that is validated better by another
  command
- behavior that cannot be exercised through browser automation and has no
  mocked or sandbox substitute

If unsure, ask the user directly.

## Organizing E2E by feature

Feature E2E tests should be organized so they map back to the approved test
plan.

Preferred layout:

```text
tests/e2e/features/<feature-id-or-slug>/<behavior>.spec.ts
```

Each feature spec should link to the relevant test plan and test-case IDs:

```ts
/**
 * Covers:
 * - test-plans/branches/<feature>/test-plan-1.md
 * - TEST_CASE_2A
 * - TEST_CASE_3A
 */
```

Feature-oriented E2E organization lets us keep broad coverage without requiring
every E2E test to run on every commit.

## Running E2E

Assume Playwright E2E tests are slow. Run the focused feature test while working:

```bash
pnpm exec playwright test tests/e2e/features/<feature-id-or-slug>
```

Run broader E2E suites when explicitly requested, before major integration
points, or when validating accumulated changes:

```bash
pnpm exec playwright test
```

If an E2E run is long-lived, use the project callback workflow:

```bash
vibe-agent callback "pnpm exec playwright test tests/e2e/features/<feature-id-or-slug>"
```

Do not claim the full E2E suite has passed unless it actually ran.

## Mocked VK sandbox work

Use the mocked VK sandbox when the work involves:

- VD opening or embedding VK surfaces
- VK workspace/craft creation from VD
- follow-up messages in VK Agent iframes
- model-provider paths that should avoid real tokens
- same-origin Caddy/VK/VD routing

Follow [`vk-mocked-sandbox.md`](./vk-mocked-sandbox.md) for sandbox startup,
fresh or seeded data, Playwright CLI usage, and cleanup.

Use fresh data when the test plan requires it. Use seeded or fixture data only
when the approved plan or user explicitly allows it.

## Recording implementer results

Record implementation validation on the implementation or QA bead.

Include:

- commands run
- E2E specs added or updated
- focused tests run
- Playwright CLI session name
- URLs
- screenshots or artifact paths
- skipped checks with reason
- deviations from the approved plan

When following an approved test plan, record results using the plan's
`TEST_CASE_*` IDs.

## Handoff to review and independent testing

Before requesting review, report:

- what changed
- what tests were added or updated
- what focused validation passed
- what E2E was added or updated
- what was not run and why
- remaining risks

Independent tester validation does not replace implementer validation. The
independent tester should be able to rerun the approved plan from your handoff
and either confirm the behavior or find a real discrepancy.

## Anti-patterns

Avoid:

- changing browser-visible behavior without opening the app
- relying on the independent tester as the first browser run
- skipping E2E because it is slow
- saying E2E is unnecessary without a clear “not relevant” reason
- using direct API mutation for user flows that should be UI-tested
- committing Playwright CLI transient refs such as `e29`
- committing raw Playwright CLI snapshots or scratch codegen output
- writing only brittle coordinate-click E2E tests
- leaving sandbox, browser, or server processes running after validation
