# DockView milestone M5.1 shadow migration test plan

- Milestone task: `vkvw-0ar0.1 — DockView M5.1 — Run shadow migration and production-like validation`
- Scope: production-like legacy Voyage migration, sanitized legacy KV fixture
  coverage, migration diagnostics, normalized Voyage/Craft/Panel/layout
  invariants, and compatibility behavior discovered from the running
  environment.
- Out of scope: checking in the raw live `kv.db`, browser E2E seeded from
  existing Voyage data, legacy layout-writer deletion, Beads product-surface
  revival, and agent-driven arbitrary pane manipulation.
- Sources of truth:
  - `DOCKVIEW_IMPLEMENTATION_PLAN.md`
  - approved M4.3 command-layer invariants
  - approved M4.4 Agent/Code/Open Surface behavior
  - approved M4.5 mobile/persistence QA findings
  - M5.1 bead notes from live `kv.db` analysis

## User stories

1. As an existing user, my saved Voyages can be migrated from legacy
   workspace/session state without losing valid Agent/Code work.
2. As an existing user, stale or obsolete legacy selections are quarantined or
   skipped with diagnostics instead of crashing migration or blocking valid
   Panels in the same Voyage.
3. As a reviewer, I can verify migration behavior using sanitized synthetic
   fixtures that preserve production-like shape without committing the live DB.
4. As a maintainer, I can trust that migrated normalized Voyage state has
   balanced audit diagnostics, deduped Craft membership, canonical Dockview
   layout, and no unsupported Beads product surface.

## Preconditions

- Work from `vk/12e4-vd-dockview` after the M5 surface alignment approval.
- Use the live running `kv.db` only as an analysis source. Do not commit raw DB
  contents or verbatim user/project data.
- Build sanitized/synthetic fixtures that preserve observed shapes:
  generated first-party selections, stale selections, duplicate workspace IDs,
  Create Workspace compatibility entries, and multi-workspace Voyages.
- Keep Beads out of rendered DockView product surfaces.
- Do not start M5.3 cleanup until this validation is reviewed and approved.

## Acceptance cases

### TEST_CASE_M5_1A — Sanitized fixture represents production-like legacy state

Steps:

1. Inspect the committed M5.1 fixture/test data.
2. Compare its shape to the live-DB pattern notes on `vkvw-0ar0.1`.
3. Confirm no raw live database or verbatim sensitive records are checked in.

Expected:

- Fixture is synthetic/sanitized, not a copy of `/home/vkuser/.local/share/.../kv.db`.
- Fixture includes legacy workspace, workspace-sessions, and enough authority
  context to run deterministic migration.
- Fixture includes multiple Crafts/workspaces and multiple Voyage entries, not
  only a single happy path.
- Test names or comments document which live-data pattern each fixture segment
  represents.

### TEST_CASE_M5_1B — Generated Agent/Code/Forms selections migrate without persisted tabs

Steps:

1. Use a legacy Craft with workspace metadata but without persisted `agent`,
   `code`, or `forms` entries in `Craft.tabs`.
2. Create saved Voyage entries selecting first-party surface IDs.
3. Run the shadow migration.
4. Inspect normalized VoyagePanel targets and diagnostics.

Expected:

- `agent`, `code`, and `forms` selections resolve from Craft workspace metadata
  plus the current first-party registry.
- Migration does not require generated first-party surfaces to be persisted in
  legacy `Craft.tabs`.
- Stored Panel targets are normalized/trusted intents, not copied live URLs.
- Valid generated selections produce migrated Panels and layout entries.

### TEST_CASE_M5_1C — Stale selections quarantine without blocking valid Panels

Steps:

1. Include stale `tab_N` selections that are absent from the referenced Craft.
2. Include at least one valid Agent or Code selection in the same saved Voyage.
3. Run migration and inspect diagnostics, panels, and layout.

Expected:

- Missing/stale selections are quarantined or skipped with explicit reason
  diagnostics.
- Valid selections in the same Voyage still migrate.
- Audit counts remain balanced; every source occurrence is accounted for.
- No stale selection appears in the canonical Dockview snapshot.

### TEST_CASE_M5_1D — Compatibility entries are skipped intentionally

Steps:

1. Include homepage/overview compatibility representation.
2. Include `Create Workspace` compatibility Crafts, including variants with
   leftover legacy tab records.
3. Include a legacy Beads selection.
4. Run migration.

Expected:

- Homepage/overview and Create Workspace compatibility entries are skipped with
  intentional reason codes.
- Legacy Beads selection is skipped as migration-only compatibility.
- Beads is not reintroduced into rendered DockView product surfaces or
  generated Agent+Beads pairs.
- Skipped compatibility entries do not cause a valid Voyage to fail migration.

### TEST_CASE_M5_1E — Duplicate workspace IDs dedupe Craft membership

Steps:

1. Include multiple legacy Crafts pointing at the same workspace ID.
2. Select valid generated surfaces from more than one duplicate Craft occurrence.
3. Run migration.

Expected:

- Normalized VoyageCraft membership is deduped by workspace ID.
- Duplicate Craft occurrences are diagnosed as duplicate membership where
  appropriate.
- Valid selected Panels are preserved under the owning normalized Craft
  workspace ID.
- No duplicate VoyageCraft row is written for the same Voyage/workspace pair.

### TEST_CASE_M5_1F — Multi-workspace Voyage produces canonical layout and history

Steps:

1. Include a saved Voyage spanning several distinct workspace IDs.
2. Include multiple migrated Panels and at least one active selection.
3. Run migration.
4. Validate normalized Voyage, VoyageCraft, VoyagePanel, VoyageLayout, and
   VoyageHistory records.

Expected:

- Migrated Voyage contains all valid Craft memberships and Panels.
- Activation sequence/active Panel are deterministic.
- Dockview snapshot is canonical and references exactly the migrated Panels.
- Initial history checkpoint matches the migrated structure.
- Empty/invalid source-only Voyages are skipped rather than written as corrupt
  normalized records.

## Required validation

Implementer and reviewer should record exact commands and, at minimum, run:

```bash
pnpm exec vitest run --config vitest.server.config.ts \
  src/store/db/legacyVoyageMigration.test.ts
pnpm exec vitest run --config vitest.server.config.ts \
  src/store/db/legacyVoyageMigration.test.ts \
  src/store/panelTargetRegistry.test.ts \
  src/store/normalizedVoyageProjection.test.ts \
  src/modules/plugins/vibe-dashboard/craft-surfaces.test.ts
pnpm test
pnpm run check-types
pnpm run build:web
pnpm test:contract:dockview
git diff --check
git status --short --branch
```

Tester should independently rerun the migration-focused commands and inspect
the fixture for raw-data leakage before approving this milestone.
