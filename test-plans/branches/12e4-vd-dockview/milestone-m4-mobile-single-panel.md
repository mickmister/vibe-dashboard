# DockView milestone M4.5 mobile single-Panel test plan

- Milestone task: `vkvw-xhd8.5 — DockView M4.5 — Implement mobile single-Panel experience`
- Scope: mobile Voyage/Panel switching, single-Panel rendering, route/focus recovery,
  homepage/empty states, and preservation of desktop Dockview topology.
- Out of scope: M5 cutover, agent-driven arbitrary pane manipulation
  (`vkvw-xhd8.7`), Spaces UI revival, and new pin/protect Panel semantics.
- Sources of truth:
  - `DOCKVIEW_IMPLEMENTATION_PLAN.md`
  - approved M4.1 sidebar/navigation behavior
  - approved M4.2 route preservation behavior
  - approved M4.3 command-layer invariants
  - approved M4.4 Open Code/Split View behavior

## User stories

1. As a mobile user, I can open a Voyage and see one usable Panel at a time
   without desktop drag/split/resize affordances.
2. As a mobile user, when a desktop split/pair is focused, the app resolves it to
   one live Panel instead of trying to render an unusable split layout.
3. As a mobile user, stale or malformed focus recovers safely to a usable Panel
   or an accessible empty state.
4. As a desktop user, the mobile single-Panel path does not alter desktop
   Dockview topology or split/pair selection behavior.
5. As a reviewer, I can see at least one real happy-path product screenshot with
   Voyage/Craft/Panel UI, not just recovery screens or technical harnesses.

## Preconditions

- Work from `vk/12e4-vd-dockview` after review-approved M4.5 commit
  `ce7ff3e5ea180aee75cedc6b2c90b738d66aceec` or later.
- Start with fresh browser/session state and isolated test data unless a case
  explicitly checks persisted route behavior.
- Use mobile viewport dimensions for mobile cases, and desktop viewport
  dimensions for desktop-regression cases.
- Use real product routes/UI where available. If a specific state is only exposed
  through a focused product-shaped harness, record that deviation explicitly.
- Capture at least one happy-path product screenshot showing a usable DockView
  state with Voyage/Craft/Panel language.
- Do not commit `.playwright-cli`, screenshots, traces, or transcript scratch
  artifacts.

## Acceptance cases

### TEST_CASE_M4_5A — Mobile renders one live Panel from split/pair focus

Steps:

1. Open a Voyage whose saved/route focus would select a desktop split/pair.
2. Set viewport to a representative mobile size.
3. Inspect the visible workbench content and selected/focused Panel.
4. Switch among available Panels from mobile navigation.

Expected:

- Exactly one live Panel is presented at a time on mobile.
- Desktop split/resize/drag affordances are not exposed as mobile editing UI.
- The selected Panel is deterministic and accessible.
- Switching Panels does not mutate desktop topology merely because mobile is
  presenting one Panel.

### TEST_CASE_M4_5B — Mobile stale/malformed focus recovery

Steps:

1. Open mobile routes with stale Panel focus, malformed focus, and pair/split
   focus where one member is unavailable.
2. Inspect visible recovery/selection behavior.
3. Use Back/Forward and reload on recovered states.

Expected:

- Invalid focus never crashes and never mutates layout unexpectedly.
- If any Panel is available, mobile recovers to the first valid available Panel.
- If no Panel is available, mobile shows accessible empty Voyage state.
- Browser Back/Forward/reload remain deterministic.

### TEST_CASE_M4_5C — Homepage and empty Voyage accessibility

Steps:

1. Open the homepage route on mobile.
2. Open an empty Voyage on mobile.
3. Inspect labels, landmarks/status messaging, and copy.
4. Confirm no user-facing Spaces language appears.

Expected:

- Homepage remains usable as landing experience.
- Empty Voyage state uses `role="status"` / `aria-live` or equivalent accessible
  announcement semantics.
- Copy uses Home / Voyage / Craft / Panel terminology.
- No user-facing Spaces revival.

### TEST_CASE_M4_5D — Desktop topology remains unchanged

Steps:

1. Open a Voyage on desktop with a split/pair layout.
2. Record layout/focus state.
3. Exercise equivalent mobile single-Panel focus behavior in a mobile viewport or
   fresh mobile session.
4. Return to desktop viewport/session and inspect layout/focus.

Expected:

- Desktop pair/split selection behavior remains unchanged.
- Desktop Dockview groups/tabs/sizes are not overwritten by mobile presentation.
- No desktop-only drag/split/resize behavior regresses.

### TEST_CASE_M4_5E — Happy-path product screenshot

Steps:

1. Open a representative happy-path DockView state after M4.5.
2. Capture a screenshot showing real product UI with Voyage/Craft/Panel language
   and a usable Panel state.
3. Record screenshot path and describe what it shows.

Expected:

- Screenshot is not just a recovery/error card and not just a low-level technical
  harness unless no product route exists; any deviation must be recorded.
- Screenshot demonstrates the feature direction clearly enough for human review.

## Required validation

Tester should record exact commands and artifacts and, at minimum, run:

```bash
pnpm install --frozen-lockfile
pnpm run check-types
pnpm exec vitest run --config vitest.server.config.ts \
  src/components/UnifiedTabView.test.ts \
  src/components/WorkspaceContentView.test.ts \
  src/components/VoyageSidebar.test.ts
pnpm run build:web
git diff --check
git status --short --branch
```

Use the Playwright CLI snapshot/ref loop from
`test-plans/onboarding/feature-work-process.md` for browser-driven portions and
capture an E2E-conversion transcript per
`test-plans/onboarding/playwright-manual-to-e2e.md`.
