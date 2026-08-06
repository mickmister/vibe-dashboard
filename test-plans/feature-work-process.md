# Feature work process

Use this process when preparing a new feature that should be validated through
manual testing and, when relevant, the mocked VK sandbox.

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

## 4. Implement, review, and run the same plan

Implement the feature after the user approves the full test plan.

During implementation:

- Keep code changes minimal and reviewable.
- Add automated tests where practical.
- Run focused tests and type checks.
- Use the mocked VK sandbox when the story involves VD/VK end-to-end behavior or
  model-provider flows that should avoid real tokens.

The implementer should manually run the approved test plan and record results
on their implementation or QA bead as JSON keyed by the test-case IDs.

## 5. Independent sandbox tester pass after approval

After implementation review is approved, a separate tester agent should create a
new tester bead for their own session.

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
