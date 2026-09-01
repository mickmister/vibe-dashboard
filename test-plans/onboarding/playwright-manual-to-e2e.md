# Playwright manual-to-E2E workflow

Use this process when a browser-driven manual test should become a committed
Playwright E2E test.

The workflow has two separate outputs:

1. **Manual-run evidence** from `pnpm playwright:cli`.
2. **A polished Playwright Test spec** committed under `tests/e2e`.

Do not commit raw Playwright CLI snapshots, transient refs, traces, screenshots,
videos, or generated scratch drafts unless a test plan explicitly says an
artifact should be versioned.

## Roles and responsibilities

### Independent tester

Independent testers run the approved manual plan, record results on their tester
bead, and produce an E2E-conversion transcript artifact when the test is
browser-driven.

Independent testers should not create or commit Playwright E2E tests unless the
prompt explicitly asks them to.

### Implementer or E2E author

The implementer or E2E author converts the manual-run transcript into a
committed Playwright Test spec, reviews and polishes the test, and runs the
focused E2E plus required repo checks.

## Manual run artifact setup

Create a dedicated artifact directory before opening the browser:

```bash
ARTIFACT_DIR="/tmp/<feature>-e2e-candidate-$(date +%Y%m%d%H%M%S)"
TRANSCRIPT="$ARTIFACT_DIR/transcript.md"
PW_SESSION="<feature>-$(date +%Y%m%d%H%M%S)"

mkdir -p "$ARTIFACT_DIR"
```

Record the following at the top of `transcript.md`:

- feature or bead ID
- approved test-plan path
- branch name
- app URL
- data mode, such as `fresh`, `seeded-basic`, or a named fixture profile
- viewport
- Playwright CLI session name
- sandbox/server startup command
- cleanup command

Example:

```md
# E2E candidate transcript

- Bead: vkvw-1234 — Example feature
- Test plan: ./test-plans/branches/example/test-plan-1.md
- Branch: vk/example
- URL: http://localhost:50005
- Data mode: fresh
- Viewport: 1280x720
- Playwright CLI session: example-20260807120000
- Startup: npm run dev:vk-mocked-sandbox
- Cleanup: Ctrl-C sandbox, then pgrep cleanup check
```

## Manual Playwright CLI pass

Use the repo-pinned Playwright CLI wrapper:

```bash
pnpm playwright:cli -s="$PW_SESSION" open "$URL"
pnpm playwright:cli -s="$PW_SESSION" resize 1280 720
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

Before each interaction:

1. Capture or reference the latest snapshot.
2. Use a ref from that snapshot for the manual action.
3. Generate a stable locator hint for important refs.
4. Append the command, snapshot path, ref, locator hint, and expected result to
   `transcript.md`.

Example:

```bash
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
pnpm playwright:cli -s="$PW_SESSION" generate-locator e29 --json
pnpm playwright:cli -s="$PW_SESSION" click e29 --json
```

Transcript entry:

```md
## Step: Open New Craft

Intent:
Open the VK workspace creation surface from VD.

Snapshot before:
.playwright-cli/page-2026-08-07T17-41-11-747Z.yml

Command:
pnpm playwright:cli -s="$PW_SESSION" click e29 --json

Ref:
e29

Generated locator hint:
getByRole('button', { name: 'New Craft' })

Expected assertion candidate:
Create Workspace iframe is visible, same-origin, and its src path is
/workspaces.
```

## Capturing additional evidence

For browser-driven tests, capture these artifacts when practical:

```bash
pnpm playwright:cli -s="$PW_SESSION" console error \
  > "$ARTIFACT_DIR/console-errors.txt"

pnpm playwright:cli -s="$PW_SESSION" requests \
  > "$ARTIFACT_DIR/requests.txt"

pnpm playwright:cli -s="$PW_SESSION" screenshot \
  --filename "$ARTIFACT_DIR/final.png" \
  --full-page
```

If trace or video capture is useful for the flow, start it before the first
mutating action and stop it after the final assertion:

```bash
pnpm playwright:cli -s="$PW_SESSION" tracing-start
pnpm playwright:cli -s="$PW_SESSION" video-start "$ARTIFACT_DIR/video.webm"

# run the manual flow

pnpm playwright:cli -s="$PW_SESSION" tracing-stop \
  > "$ARTIFACT_DIR/trace-stop.txt"
pnpm playwright:cli -s="$PW_SESSION" video-stop
```

Record the trace path printed by `tracing-stop` in `transcript.md`. If a command
is unsupported or the syntax differs in the installed CLI, record the failed
command and continue with the closest available artifact.

## What to record for each step

Every meaningful manual step should include:

- user intent
- exact command
- snapshot file used
- transient ref used, if any
- generated locator hint
- expected user-visible result
- actual observed result
- screenshot or eval output path, when useful
- deviation or fallback, if any

Record failures loudly. If the manual pass uses a workaround, mark that step as
a deviation so the E2E author can decide whether to encode the workaround,
avoid it, or file a product/test-plan issue.

## Converting the transcript into a Playwright Test

Create or update a feature-oriented spec under `tests/e2e`, preferably:

```text
tests/e2e/features/<feature-id-or-slug>/<behavior>.spec.ts
```

At the top of the spec, link the relevant test plan and test-case IDs:

```ts
/**
 * Covers:
 * - test-plans/branches/<feature>/test-plan-1.md
 * - TEST_CASE_2A
 * - TEST_CASE_3A
 */
```

Use the transcript to map each manual action into stable Playwright Test code:

| Manual transcript item | Playwright Test output |
| --- | --- |
| `click e29` | `page.getByRole('button', { name: 'New Craft' }).click()` |
| `fill e14 "Name"` | `page.getByRole('textbox', { name: 'Voyage name' }).fill(name)` |
| iframe `contentDocument` inspection | `page.frameLocator('iframe[title="..."]')` assertions |
| observed visible text | `await expect(locator).toBeVisible()` |
| final URL | `await expect(page).toHaveURL(...)` |

Do not copy transient refs such as `e29` into committed tests.

Prefer locators in this order:

1. `getByRole` for controls and landmarks.
2. `getByLabel` for form controls.
3. `getByPlaceholder` only when no label is available.
4. `getByText` for non-interactive visible text.
5. `getByTestId` when semantic locators are not stable enough.
6. CSS selectors only as a last resort.

Use `frameLocator(...)` for iframe interactions whenever possible.

Use web-first assertions:

```ts
await expect(
  page.getByRole('heading', { name: 'Name the Voyage for this workspace.' }),
).toBeVisible();
```

Avoid:

- sleeps as synchronization
- coordinate clicks
- raw `page.evaluate` as a substitute for user-visible assertions
- machine-specific absolute paths
- asserting implementation details that users cannot observe
- committing generated code before review

## Polishing checklist

Before committing an E2E test, verify that it:

- starts from an explicit data mode or fixture profile
- uses deterministic unique names for created data
- performs mutating actions through the real UI unless the plan allows setup
  shortcuts
- has stable semantic locators
- includes meaningful user-visible assertions after every major transition
- handles iframe boundaries with `frameLocator`
- records screenshots/traces only as test artifacts, not source files
- cleans up long-running processes
- has no transient Playwright CLI refs
- has no local absolute paths except values generated at runtime

## Running the E2E

Run the focused test first:

```bash
pnpm exec playwright test tests/e2e/features/<feature-id-or-slug>/<spec-name>.spec.ts --trace on
```

Then run any required repo checks for the changed files, such as:

```bash
npm run check-types
```

If a run is long-lived, use the callback workflow requested by the project:

```bash
vibe-agent callback "pnpm exec playwright test tests/e2e/features/<feature-id-or-slug>/<spec-name>.spec.ts --trace on"
```

## Relationship to Playwright codegen

Use `pnpm playwright:cli` for agent-driven manual testing because it works well
from the terminal through snapshots and refs.

Use Playwright `codegen` only when a human-visible browser/Inspector workflow is
available and useful:

```bash
pnpm exec playwright codegen "$URL" \
  --target=playwright-test \
  -o "$ARTIFACT_DIR/generated-draft.spec.ts"
```

Treat codegen output as a scratch draft. Review and polish it using the same
rules above before committing.
