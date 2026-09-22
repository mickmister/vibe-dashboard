# Feature work process

Use this process when preparing a new feature that should be validated through
manual testing and, when relevant, the mocked VK sandbox.

## Test-plan directory layout

Keep `test-plans` organized with exactly these top-level directories:

- `test-plans/onboarding/` for reusable process and sandbox documentation.
- `test-plans/branches/<branch-slug>/` for branch-specific approved test plans.

Store feature plans under the matching branch directory, for example
`test-plans/branches/3237-vd-mocked-model/test-plan-1.md`.

## 1. Confirm the user story first

Start by writing the user story in plain language:

- Who is the user?
- What are they trying to do?
- What outcome tells them the feature worked?
- What constraints matter, such as using only VD UI, avoiding real model tokens,
  using fresh data, or testing mobile layout?

Stop and verify the user story with the user before planning implementation or
writing code. Update the story until the user confirms it is correct.

## 2. Draft high-level manual testing steps

Write the smallest deterministic manual test plan that proves the confirmed
user story. The plan should describe what the tester does in the UI and what
they should observe.

Use stable test-case IDs such as `TEST_CASE_1A`, `TEST_CASE_2A`, etc. These IDs
are used later when the implementer and independent tester record results on
their beads.

Mark steps that likely need deeper error coverage with a small marker:

```md
[ERROR_TESTING_NEEDED]
```

Example:

```md
### TEST_CASE_3A — Submit feature form

Steps:

1. Open the feature form.
2. Fill all required fields.
3. Click `Submit`. [ERROR_TESTING_NEEDED]

Expected:

- The success state appears.
```

Stop and verify the high-level test plan with the user before implementation.

## 3. Expand targeted error testing

After the user approves the high-level plan, go back through the plan and focus
on every `[ERROR_TESTING_NEEDED]` marker.

For each marked step, think hard about failures that would materially affect
confidence in the feature. Enumerate concrete error cases in-place under that
test case.

Prefer practical cases over exhaustive lists. Include cases such as:

- Required inputs missing.
- Invalid values or unsupported formats.
- Backend/API failure.
- Slow/loading state.
- Retry or duplicate-submit behavior.
- Permission or unavailable dependency.
- Empty state.
- Mobile or constrained viewport behavior.
- Recovery path after dismissing or correcting an error.

Remove the marker after replacing it with explicit error cases, or keep the
marker only when a follow-up decision is still needed.

Stop again and verify the whole test plan with the user after adding error
coverage.

## 4. Required agent-driven browser workflow

All test plans that require browser interaction should include an
agent-driven browser workflow section. Use Playwright's agent-friendly CLI for
new testing plans. For browser-driven manual tests that should become committed
E2E coverage, also follow
[`playwright-manual-to-e2e.md`](./playwright-manual-to-e2e.md).

Use the Playwright CLI snapshot/ref loop:

```bash
PW_SESSION='<unique-session-name>'

pnpm playwright:cli -s="$PW_SESSION" open "$URL"
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
pnpm playwright:cli -s="$PW_SESSION" click e<N> --json
pnpm playwright:cli -s="$PW_SESSION" fill e<N> "value" --json
```

The `playwright:cli` package script invokes the repo-pinned
`@playwright/cli` dev dependency and sets `PLAYWRIGHT_MCP_SANDBOX=false`.

Guidelines:

- Use a unique `-s=<session>` name for each testing session.
- Take a fresh `snapshot --json` before interacting, and again after
  navigation, modal changes, iframe changes, or major re-renders.
- Use refs from the latest snapshot for exploration only. Refs such as `e4`
  are transient and must not appear in committed tests.
- For each important ref, ask Playwright CLI for a stable locator:

  ```bash
  pnpm playwright:cli -s="$PW_SESSION" generate-locator e<N> --json
  ```

- Record exact commands, URLs, snapshot paths, generated locator hints,
  screenshot paths, and observed results on the testing bead.
- Keep Playwright CLI artifacts such as `.playwright-cli/` out of commits.
- Use another browser automation tool only as a documented fallback when
  Playwright CLI cannot reach or operate the required browser surface.

## 5. Required E2E test creation workflow

When a manual browser test proves behavior that should remain covered, create a
Playwright E2E test from the agent-driven session rather than authoring the
test upfront. Use
[`playwright-manual-to-e2e.md`](./playwright-manual-to-e2e.md) as the source of
truth for transcript artifacts, locator conversion, polishing, and validation.

Required flow:

1. Run the approved browser test interactively with Playwright CLI.
2. Save a transcript artifact that maps each action to:
   - the command that was run
   - the latest snapshot/ref used
   - the generated stable locator hint, when available
   - the expected user-visible result
3. Convert the transcript into a draft Playwright Test spec.
4. Polish the draft before committing:
   - import from `playwright/test` in this repo
   - replace transient refs with semantic locators such as `getByRole`,
     `getByLabel`, `getByText`, `getByPlaceholder`, or `frameLocator`
   - use web-first assertions with `expect`
   - avoid coordinate clicks unless there is no stable semantic path
   - split repeated flow into small helpers only when it improves readability
5. Run the focused E2E test and required repo checks.
6. Commit only the polished test and supporting helpers/docs. Do not commit raw
   recordings, Playwright CLI snapshots, traces, screenshots, or generated
   scratch drafts unless the test plan explicitly says an artifact should be
   versioned.

Example polished output:

```ts
import { expect, test } from 'playwright/test';

test('submits the profile form', async ({ page }) => {
  await page.goto(process.env.E2E_BASE_URL!);

  await page.getByRole('textbox', { name: 'Name' }).fill('Ada Lovelace');
  await page.getByLabel('Role').selectOption('developer');
  await page.getByRole('checkbox', { name: 'Subscribe to updates' }).check();
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.getByRole('status')).toHaveText(
    'Saved Ada Lovelace as developer; subscribe=true',
  );
});
```

## 6. Implement, review, and run the same plan

Implement the feature after the user approves the full test plan.

During implementation, follow
[`implementer-testing-process.md`](./implementer-testing-process.md). In
particular:

- Keep code changes minimal and reviewable.
- Practice TDD when practical.
- Add automated tests for changed behavior.
- For browser-visible work, create or update Playwright E2E coverage unless E2E
  is not relevant to the work being created. If unsure whether E2E is
  necessary, ask the user directly.
- Run focused tests and type checks.
- Use the mocked VK sandbox when the story involves VD/VK end-to-end behavior or
  model-provider flows that should avoid real tokens.

The implementer should manually run the approved test plan and record results
on their implementation or QA bead as JSON keyed by the test-case IDs.

Assume E2E tests are slow. Run the focused feature E2E while implementing, and
leave broad/full E2E reverification available for explicit, scheduled, or later
validation rather than requiring every E2E test on every commit.

## 7. Independent sandbox tester pass after approval

After implementation review is approved, a separate tester agent should create a
new tester bead for their own session.

Use [`independent-tester-prompt.md`](./independent-tester-prompt.md) as the
reusable feature-agnostic prompt template. The actual tester message should only
fill in the feature/test-plan bead and approved test-plan document paths.

The tester should:

1. Use the same approved markdown test plan.
2. Start a fresh sandbox environment when the plan requires it.
3. Follow the test plan literally.
4. Record results as a bead comment using JSON keyed by the same test-case IDs.
5. Include exact URLs, commands, screenshot paths, and blocker notes.

Example result comment:

```json
{
  "TEST_CASE_1A": { "status": "PASS" },
  "TEST_CASE_2A": {
    "status": "FAIL",
    "notes": "Expected validation message did not appear after submitting an empty field."
  }
}
```

The feature should not be considered fully accepted until both the implementer
and independent tester have passed, or remaining failures have explicit user
approval to defer.
