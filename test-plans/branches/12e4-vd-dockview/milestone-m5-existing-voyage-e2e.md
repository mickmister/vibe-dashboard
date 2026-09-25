# DockView milestone M5.2 existing Voyage E2E test plan

- Milestone task: `vkvw-0ar0.2 — DockView M5.2 — Add end-to-end Dockview workbench coverage`
- Scope: browser-level full-flow DockView coverage seeded from existing
  Voyage-shaped data, using VK qa-mode/real-enough surfaces and the approved
  Agent/Code/Forms product-surface contract.
- Out of scope: synthetic `/internal` product surface delivery, Vite dev-server
  proxy coupling, raw live DB fixtures, M5.3 legacy writer deletion, and Beads
  as a rendered DockView product surface.
- Sources of truth:
  - M5.1 sanitized migration fixture/test plan
  - approved M4.4 Open Code/Split View behavior
  - approved M4.5 mobile single-Panel behavior
  - approved M5 surface alignment: Agent, Code, Forms only
  - `test-plans/onboarding/vk-mocked-sandbox.md`

## User stories

1. As an existing user, I can open the app with preexisting Voyage data and see
   usable DockView sidebar/workbench state without starting from a blank
   onboarding flow.
2. As an Agent user, existing Agent/Code surfaces render through real qa-mode
   route shapes, not fake `/internal` harness pages.
3. As a mobile user, an existing migrated Voyage still presents one live Panel
   at a time and survives reload.
4. As a reviewer, I can inspect screenshots/artifacts proving the existing-data
   path works end to end.

## Preconditions

- M5.1 shadow migration validation is implemented and reviewed.
- Use a sanitized existing Voyage-shaped seed derived from M5.1 patterns.
- Use VK qa-mode or the approved real-enough VK sandbox path for browser E2E.
- Agent/VK surfaces should use existing VK route shapes such as
  `/workspaces/:workspaceId`; Code should use the existing Code route builder.
- Forms should render as a first-party React surface, not an iframe unless a
  future product decision changes that.
- Do not commit browser scratch artifacts, raw DBs, `.playwright-cli`, traces,
  or screenshots outside approved artifact directories.

## Acceptance cases

### TEST_CASE_M5_2A — Existing Voyage seed boots to usable DockView state

Steps:

1. Start the E2E environment from clean browser state and seeded existing
   Voyage-shaped data.
2. Open the dashboard product route.
3. Inspect sidebar, active Voyage, Craft rows, and visible Panel.
4. Capture a screenshot.

Expected:

- App boots without onboarding-only assumptions.
- Sidebar shows Home/Voyages/Crafts/Panels language and no user-facing Spaces.
- A seeded Voyage can be selected/opened.
- Workbench renders a usable Agent/Code/Forms Panel, not recovery/error UI.
- Screenshot demonstrates the existing-data happy path.

### TEST_CASE_M5_2B — Real qa-mode Agent/Code route shapes are used

Steps:

1. Open a seeded Voyage containing Agent and Code selections.
2. Inspect iframe/source route information and visible surface state.
3. Exercise Agent-to-Code Open Code behavior.

Expected:

- Agent uses the existing VK qa-mode route shape, e.g. `/workspaces/:workspaceId`,
  not `/internal/dockview-*` fake delivery.
- Code uses the existing Code URL builder for the workspace/folder.
- Open Code reuses/selects/places Code according to the approved M4.4 contract.
- No Beads surface is rendered or generated.

### TEST_CASE_M5_2C — Split View works from seeded existing data

Steps:

1. From a seeded Agent or Code Panel, enter Split View with trusted query intent.
2. Test same-Craft default target and permitted cross-Craft target.
3. Exit Split View and return to the underlying Voyage.

Expected:

- Split View resolves trusted targets deterministically.
- Split-only transient target behavior matches M4.4.
- Underlying Voyage layout/history is not mutated by transient Split View.
- Invalid route intent recovers safely.

### TEST_CASE_M5_2D — Mobile existing Voyage behavior

Steps:

1. Open the same seeded Voyage at a mobile viewport.
2. Select Agent, Code, and Forms surfaces where available.
3. Reload and use Back/Forward.

Expected:

- Mobile presents one live Panel at a time.
- Stale or unsupported selections recover to a valid Panel or accessible empty
  state.
- Reload/reopen preserves usable seeded Voyage state.
- Desktop topology is not overwritten by mobile presentation.

### TEST_CASE_M5_2E — Persistence/reload and diagnostics remain stable

Steps:

1. Open seeded Voyage, switch surfaces, use Open Code/Split View, then reload.
2. Reopen from sidebar and direct URL.
3. Inspect logs/console/network for persistence errors.

Expected:

- Seeded Voyage survives reload/reopen.
- No `/kv/set` 400 storm or iframe 404 error recurs.
- Any intentionally stale seed entries remain diagnosed/recovered, not silently
  promoted to valid Panels.
- Git worktree remains clean after E2E cleanup.

## Required validation

Implementer/reviewer should record exact commands and, at minimum, run:

```bash
pnpm install --frozen-lockfile
pnpm run check-types
pnpm test
pnpm test:contract:dockview
pnpm run build:web
npm run test:e2e
npm run e2e:vk-mocked-sandbox:validate -- --variant basic-seeded
git diff --check
git status --short --branch
```

Tester should run the browser flow independently, record the commit tested, and
store:

- results JSON;
- transcript;
- at least one desktop happy-path screenshot;
- at least one mobile happy-path screenshot;
- notes confirming no raw live DB was used as checked-in seed data.
