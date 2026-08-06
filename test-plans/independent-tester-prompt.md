# Reusable independent tester prompt

Use this prompt when asking a tester agent to run an independent pass for a
feature branch. Keep the actual message to the tester small by filling only the
feature-specific placeholders below.

## Prompt template

```text
Run an independent tester pass for the current feature branch.

Use `vibe-agent full_summary` to catch up.

Create a fresh tester bead for this testing session. The tester bead should
reference:

- Feature/test-plan bead: <TEST_PLAN_BEAD_ID> — <TEST_PLAN_BEAD_TITLE>
- Approved test-plan document(s): <TEST_PLAN_DOC_PATHS>

Follow the approved test plan literally. Treat the markdown test plan as the
source of truth for:

- setup/preconditions
- fresh data requirements
- exact UI flow
- expected results
- cleanup/stop steps
- result schema

General expectations:

- Use the real product UI as much as possible.
- Do not use shortcuts, direct API mutation, seeded data, or alternate flows
  unless the test plan explicitly instructs you to.
- Start with fresh state/data exactly as documented.
- Capture screenshots or other artifacts when the test plan requests them.
- Record exact commands, URLs, artifact paths, notable environment details, and
  any deviations from the plan.
- Stop/clean up any long-running processes according to the plan.
- Record results on your tester bead as a JSON comment keyed by the test plan's
  `TEST_CASE_*` IDs.

Result format example:

{
  "TEST_CASE_1A": { "status": "PASS" },
  "TEST_CASE_2A": {
    "status": "FAIL",
    "notes": "Expected X, observed Y. Screenshot: /tmp/example.png"
  }
}

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

Report PASS/FAIL/BLOCKED clearly. If not approved, do not implement fixes;
include:

- failing test case ID(s)
- observed behavior
- expected behavior
- artifact paths
- smallest actionable fix needed
```

## Minimal feature-specific message shape

```text
Run an independent tester pass using the reusable tester prompt:

<PATH_TO_THIS_FILE>

Feature/test-plan bead:
- <TEST_PLAN_BEAD_ID> — <TEST_PLAN_BEAD_TITLE>

Approved test-plan document(s):
- <TEST_PLAN_DOC_PATH_1>
- <TEST_PLAN_DOC_PATH_2>
```
