# Whole-App UI Customization Implementation Plan

Date: 2026-08-31

Related local work:

- `vkvw-9yay — Design slot-based styling extraction pilot for SpacesOverview`
- Current branch: `vk/2286-vd-redesign-2`
- Research branch: `vk/55fd-vd-themes-and-sk`
- Architecture source: `/var/tmp/vibe-kanban/worktrees/2286-vd-redesign-2/ui-injection.md`

## 1. Objective and non-goals

### Objective

Make the whole application UI governed by a single customization architecture:

```text
application/domain behavior
  -> controller hosts
  -> typed view models/actions
  -> swappable view packs
  -> semantic DOM + primitives
  -> global skin runtime
  -> CSS variables + scoped skin CSS
```

The result should let users customize the UI as much as possible without making
untrusted runtime JavaScript the foundation.

### Product goal

Customization must serve three personas:

1. Amateur users choose good-looking off-the-shelf skins.
2. Non-programmers with taste iterate with the AI on a validated skin package.
3. CSS experts author scoped CSS, share packages, and eventually contribute to a
   marketplace.

### Non-goals for the first implementation wave

- Runtime user-provided JavaScript plugins.
- Per-voyage skins.
- Dynamic runtime view-pack discovery.
- A complete app-wide migration in one PR.
- Replacing Tailwind everywhere.

Global-only customization is the initial product scope.

## 2. Research findings and constraints

### UI injection local spec

The local UI-injection spec says the core invariant is:

> Any decision whose purpose is how the application looks, is structured, or
> presents an interaction should be disposable and replaceable without changing
> application behavior.

Important implications:

- Hooks belong in hosts/controllers, not swappable presentation.
- Raw intrinsic JSX belongs in primitive/view renderers, not behavior files.
- Production UI selection should be explicit source code initially.
- Storybook is the experimentation environment.
- Application/domain state must not depend on selected presentation.

### Tailwind and CSS variables

Tailwind is compatible with a variable-driven skin system. Tailwind's current
theme-variable model is explicitly based on CSS custom properties; Tailwind
theme variables influence generated utilities and are usable as runtime CSS
variables. Source: Tailwind theme variables documentation:
https://tailwindcss.com/docs/theme

Tailwind should remain useful for structural layout utilities, but visual
identity should move toward CSS variables and CSS Modules.

### CSS Modules and Vite

Vite treats `.module.css` files as CSS Modules and returns a module object when
they are imported. Source: Vite CSS features documentation:
https://vite.dev/guide/features

This means CSS Modules are a good fit for source-controlled view-pack styling.
They are not, by themselves, the public user customization API because class
names are intentionally local/compiled.

### CSS custom properties

CSS custom properties participate in normal CSS cascade and inheritance and can
be read by descendants via `var(...)`. Source: MDN custom properties guide:
https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties

This makes them the right foundation for global app skins.

### Cascade layers

CSS cascade layers provide explicit control over precedence between groups of
styles. Source: MDN `@layer` reference:
https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40layer

We should use layers to make precedence predictable:

```css
@layer reset, tailwind, vd-base, vd-components, vd-skin, vd-user;
```

### DeepSeek Harness

DeepSeek Harness markets an "everything is a plugin" model where plugins can
provide models, tools, skills, sessions, storage, scheduling, and UI. Source:
DeepSeek Harness official page: https://deepseek.com/harness/en/

Its lesson is useful: capabilities can be swappable. Its trust model is not the
right first layer for end-user UI customization because UI plugins imply runtime
code trust, permissioning, compatibility management, and failure isolation.

We should borrow the composability philosophy, but first ship data/CSS based
customization.

### OpenLint current affordances

Current environment-owned OpenLint commands:

```sh
ol check --preset tsx-view-boundary <folder>
ol check --preset ui-customization-fences <folder>
```

Examples:

```sh
ol check --preset tsx-view-boundary /path/to/repo
ol check --preset ui-customization-fences /path/to/repo
ol check --changed --preset ui-customization-fences --target /path/to/repo
ol check --last-commit --preset ui-customization-fences /path/to/repo --json
```

The OpenLint default policy directory is the source of truth for these presets;
repo scripts intentionally do not pass `--policy-dir`.

OpenLint supports `--changed`, `--changed-since`, `--last-commit`, and
`--commit-range`. Repo-local `openlint.yaml` is supported when this repo needs
checked-in overrides, but the team/environment defaults stay outside this repo.

## 3. Target architecture

### Layer responsibilities

```text
Controller / host
  - hooks
  - application state
  - async effects
  - mutations
  - navigation
  - model/action adaptation

Contracts
  - view model types
  - action types
  - slot names
  - primitive obligations
  - skin token names

View pack
  - major structure
  - section ordering
  - responsive composition
  - semantic slot boundaries
  - no hooks

Primitive/view files
  - intrinsic JSX
  - ARIA/native semantics
  - keyboard/focus behavior
  - CSS Module class application

Skin runtime
  - global active skin
  - CSS variables
  - scoped validated raw CSS
  - cascade layer placement

Skin package
  - versioned JSON
  - tokens
  - component/surface recipes
  - optional scoped CSS
  - optional package assets later
```

### Dependency rule

Allowed:

```text
controller -> contracts -> selected view pack -> primitives/styles
```

Forbidden:

```text
domain logic -> concrete view implementation
skin package -> Tailwind implementation classes
view pack -> API clients/router/query libraries
```

## 4. Customization personas

### Amateur user

Needs:

- Built-in skin gallery.
- Preview thumbnails.
- Names that describe taste: "Default Dark", "Light Studio", "Terminal",
  "Calm Graphite", "Warm Focus".
- Simple density control: compact, comfortable, spacious.
- One global "Apply" button.

Should not need:

- CSS knowledge.
- JSON editing.
- Raw selector docs.

### Non-programmer with design taste

Needs:

- AI-assisted skin creation.
- Natural-language iteration.
- Live preview before save.
- Safe diagnostics if generated CSS is invalid.
- Undo/revert to built-in.

Example interaction:

```text
"Make the app feel like a quiet graphite writing studio, dense but warm."
```

The AI should edit a skin package, not arbitrary app source.

### CSS guru / marketplace contributor

Needs:

- Stable selector map.
- Token reference.
- Local `.vibe-dashboard/skins/*.json` package workflow.
- Scoped raw CSS escape hatch.
- Exact validation diagnostics.
- Export/import.
- Future marketplace package metadata.

Should not need:

- Runtime JS.
- Targeting Tailwind class names.
- Forking source for visual-only changes.

## 5. Skin system salvage plan from `vk/55fd-vd-themes-and-sk`

Treat the branch as research/plumbing, not as the philosophical base.

### Keep or port with adaptation

Useful skin-management plumbing:

- Versioned manifest schema.
- Built-in skin registry.
- Skin state migration/defaulting.
- Import/export package helpers.
- Save/delete/upsert helpers.
- Raw CSS sanitizer.
- Runtime CSS variable resolution.
- `SkinRoot` concept.
- Agent-editable package directory concept.
- Unit tests for schema, sanitizer, editor helpers, and runtime.

Likely source files to salvage:

```text
src/theme/skins/types.ts
src/theme/skins/schema.ts
src/theme/skins/builtin.ts
src/theme/skins/editor.ts
src/theme/skins/runtime.tsx
src/theme/skins/index.ts
src/theme/skins/*.test.ts
src/theme/skins/skin-runtime.css
```

### Rewrite before adopting

- `SkinEditorDialog.tsx`
- `SkinLab.stories.tsx`
- Storybook preview integration
- WorkspaceShell integration
- Sidebar integration
- SpacesOverview integration
- Modal/dialog integration

These need to be reshaped into controller/view/contract boundaries.

### Remove or defer

- Per-voyage skin assignment UI/state.
- `setVoyageSkin`.
- Active-voyage projection semantics.
- VK projection until the global skin runtime is stable.
- Runtime user JS plugins.

### Rewrite selector philosophy

Migration hack to avoid:

```css
[data-vd-component='dashboard'] [class*='bg-zinc'] { ... }
```

Target philosophy:

```css
[data-vd-surface='spaces-overview'] [data-vd-slot='workspace-row'] { ... }
```

The app should expose a public semantic DOM contract; skins should not target
Tailwind internals.

## 6. Global skin state model

Initial persistent state:

```ts
type VDSkinState = {
  version: 1;
  userSkins: VDSkinManifestV1[];
  activeGlobalSkinId: string;
};
```

Initial actions:

```ts
importSkinPackage(args)
saveSkin(args)
deleteSkin(args)
setGlobalSkin(args)
validateAgentSkinPackages()
```

No per-voyage assignment in v1.

### Skin package shape

```ts
type VDSkinManifestV1 = {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  author?: string;
  tokens: VDSkinTokens;
  surfaces: Record<VDSurfaceId, VDSurfaceRecipe>;
  components: Record<VDComponentId, VDComponentRecipe>;
  rawCss: VDSkinRawCssBlock[];
};
```

Prefer `surfaces` and `components` over the old branch's broad taxonomy.

## 7. Semantic UI contract

Every migrated surface should expose stable semantic hooks.

### Required attributes

Use these on meaningful boundaries:

```tsx
data-vd-component
data-vd-surface
data-vd-slot
data-vd-state
data-vd-density
```

Examples:

```tsx
<section
  data-vd-component="surface"
  data-vd-surface="spaces-overview"
  data-vd-slot="workspace-list"
/>
```

```tsx
<article
  data-vd-component="workspace-row"
  data-vd-surface="spaces-overview"
  data-vd-slot="workspace-row"
  data-vd-state="running unseen"
/>
```

### Initial surface IDs

```text
app-shell
sidebar
voyage-bar
spaces-overview
workspace-content
modal
menu
skin-editor
```

### Initial component IDs

```text
button
input
field
dialog
card
row
badge
tab
toolbar
section
list
empty-state
loading-state
error-state
```

Do not over-model every div. Start with styling boundaries users will actually
want to target.

## 8. Tailwind, CSS Modules, and skin CSS policy

### Tailwind role

Tailwind remains allowed for structural mechanics:

```text
display: flex/grid/block/hidden
positioning: relative/absolute/fixed/inset/z
layout: w/h/min/max/overflow
alignment: items/justify/self
responsive breakpoints
text mechanics: truncate/break-words/sr-only
```

Tailwind should gradually stop owning visual identity:

```text
bg-*
text-color utilities
border-color utilities
rounded-*
shadow-*
ring-color utilities
font-family/weight where skin-owned
tracking where skin-owned
```

### CSS Modules role

CSS Modules are for source-controlled, app-authored view-pack styling:

```text
DefaultSpacesOverview.module.css
DenseSpacesOverview.module.css
SkinEditorDialog.module.css
```

CSS Modules should use skin variables:

```css
.row {
  background: var(--vd-spaces-overview-row-bg);
  color: var(--vd-spaces-overview-row-fg);
  border-color: var(--vd-spaces-overview-row-border);
  border-radius: var(--vd-radius-md);
}
```

CSS Module class names are not the public user API.

### Skin CSS role

Skin CSS is user-authored or AI-authored, scoped and validated:

```css
[data-vd-skin-root] [data-vd-surface='spaces-overview'] {
  --vd-spaces-overview-row-bg: #111116;
}
```

Skin CSS should target `data-vd-*` attributes and variables.

## 9. OpenLint configuration and enforcement strategy

### Immediate npm scripts

Current repo scripts use `ol` directly and rely on the environment policy:

```json
{
  "lint:tsx-view-boundary": "ol check --preset tsx-view-boundary",
  "lint:tsx-view-boundary:migrated": "ol check --preset tsx-view-boundary src/components/spaces-overview",
  "lint:tsx-view-boundary:changed": "ol check --changed --preset tsx-view-boundary --target .",
  "lint:tsx-view-boundary:last-commit": "ol check --last-commit --preset tsx-view-boundary --target .",
  "lint:ui-fences": "ol check --preset ui-customization-fences",
  "lint:ui-fences:migrated": "ol check --preset ui-customization-fences src/components/spaces-overview",
  "lint:ui-fences:changed": "ol check --changed --preset ui-customization-fences --target .",
  "lint:ui-fences:last-commit": "ol check --last-commit --preset ui-customization-fences --target ."
}
```

Use the `:migrated` scripts as pass/fail checks for surfaces that have moved
into the customization architecture. Use the broader scripts manually to inspect
the rest of the app before adding new migrated targets.

### Repo target file

The repo-owned target manifest is:

```text
openlint/ui-customization-targets.json
```

Current scope:

```json
{
  "migratedSurfaces": [
    {
      "name": "spaces-overview",
      "path": "src/components/spaces-overview",
      "status": "pilot"
    }
  ],
  "reviewOnlySurfaces": [
    {
      "name": "app-components",
      "path": "src/components"
    },
    {
      "name": "skin-runtime",
      "path": "src/theme/skins"
    }
  ]
}
```

OpenLint does not consume this manifest directly yet; it is a checked-in
contract for scripts, reviews, and future OpenLint target-manifest support.
Use `npm --silent run ... -- --json` when another tool needs machine-readable
JSON without npm's script banner.

### Rules to add over time

Existing:

- no hooks in `*.view.tsx`
- no intrinsic JSX outside `*.view.tsx`

New:

- no visual-identity Tailwind in migrated view files
- require semantic `data-vd-*` hooks on migrated surface roots/slots
- reject skin CSS selectors that target Tailwind classes
- require CSS Modules to use `var(--vd-...)` for skin-owned properties

### Enforcement rollout

1. `error`: current two UI-injection rules on migrated surfaces.
2. `warn`: Tailwind visual utility usage on migrated surfaces.
3. `warn`: missing semantic hooks.
4. Promote warnings to errors after the `SpacesOverview` vertical slice works.

## 10. Canonical pilot: `SpacesOverview`

`SpacesOverview` remains the first vertical slice because current work already
proved:

- controller/view split;
- shared view model/actions;
- selected presentation;
- UI pack extension;
- alternate workspace-list slot;
- OpenLint compliance for selected files.

### What to keep from current POC

- `SpacesOverview.tsx` as controller/host.
- `SpacesOverview.contracts.ts`.
- `SpacesOverview.selected.ts`.
- The idea of `SpacesOverviewUIPack`.
- The dense alternate slot as proof of swap.
- Focused model helper tests.

### What to reshape

- Split large view parts further only where it improves swappability.
- Add semantic `data-vd-*` attributes.
- Move visual identity from hardcoded Tailwind classes into CSS variables/CSS
  Modules.
- Align tokens with the skin runtime.
- Make Storybook switch skin + view pack.

### Pass criteria

- Default skin, light skin, and high-contrast skin visibly affect the surface.
- A CSS-only skin can substantially change visual feel.
- An alternate view pack can substantially change layout.
- No controller changes are required to switch either skin or view pack.
- OpenLint passes for migrated target.
- Existing unit tests pass.

## 11. Skin runtime integration

### Runtime component

Use a global skin root:

```tsx
<SkinRoot state={skinState} className="h-full w-full" syncDocument>
  <App />
</SkinRoot>
```

### Runtime responsibilities

- Resolve active global skin.
- Emit CSS variables on the skin root.
- Add attributes:
  - `data-vd-skin-root`
  - `data-vd-skin-id`
  - `data-vd-density`
- Inject sanitized raw CSS in a predictable cascade layer.
- Restore previous document styles/attributes on unmount in tests/storybook.

### Runtime should not

- Know about per-voyage state.
- Override Tailwind classes by substring as a permanent strategy.
- Load or execute arbitrary package files directly.
- Fetch remote assets from skin CSS.

## 12. Skin management plumbing

### Files to port first

Port the non-UI core from `vk/55fd-vd-themes-and-sk` into a new implementation
that matches global-only state:

```text
src/theme/skins/types.ts
src/theme/skins/schema.ts
src/theme/skins/builtin.ts
src/theme/skins/editor.ts
src/theme/skins/runtime.tsx
src/theme/skins/index.ts
src/theme/skins/*.test.ts
```

### Tests to preserve

- Accept complete skin package.
- Reject unsafe package data.
- Reject invalid raw CSS.
- Reject broad selectors.
- Reject URLs/imports in raw CSS.
- Import/export round trip.
- Default/migrate state.
- Runtime variable application.
- Runtime raw CSS scoping.

### Tests to rewrite

- Per-voyage assignment tests become global active skin tests.
- VK projection tests are deferred.
- Skin editor UI tests are rewritten after the editor is split.

## 13. Skin editor redesign

The editor should be a migrated surface, not a monolith.

Target structure:

```text
src/theme/skins/SkinEditorDialog.tsx
src/theme/skins/SkinEditorDialog.contracts.ts
src/theme/skins/SkinEditorDialog.view.tsx
src/theme/skins/SkinEditorDialog.module.css
src/theme/skins/SkinEditorDialog.selected.ts
```

### Controller owns

- selected skin id;
- draft skin state;
- validation;
- import/export text;
- save/delete/apply mutations;
- agent package validation action calls.

### View owns

- beginner/custom/expert layout;
- form semantics;
- diagnostic display;
- preview region;
- import/export controls;
- raw CSS textarea.

### Modes

1. Beginner:
   - choose built-in skins;
   - density;
   - apply/revert.
2. AI-assisted:
   - show editable prompt/history later;
   - validate generated package;
   - preview before save.
3. Expert:
   - token fields;
   - raw CSS editor;
   - import/export;
   - marketplace metadata later.

## 14. Storybook customization lab

Storybook is the safe place to experiment quickly.

Required globals:

- skin;
- density;
- view pack;
- iframe render mode.

Required stories:

- `SpacesOverview` default view pack with each built-in skin.
- `SpacesOverview` dense/operator view pack with each built-in skin.
- loading/empty/error/running-dev-server states.
- Skin editor beginner and expert states.

Storybook tests are not the product gate yet, but Storybook build should pass
once the lab is wired.

## 15. Branch convergence strategy

### Do not directly rebase as the default

The skins branch has lots of useful code, but it is philosophically outdated.
A direct rebase or merge would import outdated UI integration and create
conflicts in the exact files we are trying to untangle.

### Recommended path

1. Create a new integration branch from current UI-customization work.
2. Port skin core plumbing from `vk/55fd-vd-themes-and-sk`.
3. Rewrite global-only state shape.
4. Wire `SkinRoot`.
5. Make `SpacesOverview` skin-native.
6. Rewrite `SkinEditorDialog` as controller/view.
7. Reconcile Storybook after the architecture is stable.

### Biggest conflict areas observed

Dry merge showed conflicts in:

- `.storybook/preview.tsx`
- `AddTabModal.tsx`
- `IframePanel.tsx`
- `SpacesOverview.tsx`
- `WorkspaceShell.tsx`
- `WorkspaceShellScenes.tsx`
- `AddVKWorkspaceModal.tsx`
- multiple story files

### Biggest semantic risks

- Old `SpacesOverview` monolith vs current extracted architecture.
- Skin CSS targeting Tailwind class substrings.
- Per-voyage assumptions conflicting with global-only scope.
- Large mixed UI files failing OpenLint once targeted.
- Storybook/provider setup diverging between branches.

## 16. Testing and validation strategy

### Always run for source changes in `src`

```sh
npm run check-types
```

### Pilot validation

```sh
npm test -- src/components/spaces-overview/SpacesOverview.model.test.ts
npm run lint:ui-fences:migrated
npm test
```

### Skin core validation

```sh
npm test -- src/theme/skins
npm run check-types
```

### Storybook validation

```sh
npm run build-storybook
```

### Visual validation

For each migrated surface:

- default dark screenshot;
- light screenshot;
- high contrast screenshot;
- dense view pack screenshot if applicable;
- compare for readability, spacing, contrast, and state clarity.

## 17. Rollout phases

### Phase 0: architecture doc

Land this plan and agree on:

- global-only skin scope;
- CSS variables/data attributes as public API;
- CSS Modules as source-controlled view-pack styling;
- Tailwind structural-only direction;
- no runtime JS plugins yet.

### Phase 1: OpenLint scripts and target manifest

Add npm scripts and an initial migrated-target manifest.

Target:

```text
src/components/spaces-overview
```

Status: implemented in this branch through `lint:tsx-view-boundary:*`,
`lint:ui-fences:*`, and `openlint/ui-customization-targets.json`.

### Phase 2: skin core port

Port/adapt the useful skin plumbing from `vk/55fd-vd-themes-and-sk`.

Scope:

- global-only state;
- schema;
- sanitizer;
- runtime;
- built-ins;
- core tests.

### Phase 3: SpacesOverview vertical slice

Make `SpacesOverview` the canonical example:

- semantic hooks;
- CSS Modules;
- skin variables;
- alternate view pack;
- Storybook switcher.

### Phase 4: Skin editor migrated surface

Rewrite skin editor in UI-injection shape.

### Phase 5: app shell surfaces

Migrate:

- app shell;
- sidebar;
- voyage bar;
- modals;
- menus;
- loading/error placeholders.

### Phase 6: marketplace-ready package workflow

Add:

- package metadata;
- screenshots/previews;
- validation report;
- contribution/export flow;
- marketplace safety policy.

## 18. Success criteria

### Amateur success

A user can globally apply a built-in skin and immediately understand what
changed.

### AI-assisted success

The AI can generate a skin package from taste language, validation catches
mistakes, and the user can preview/save without touching source code.

### CSS guru success

A CSS expert can make the app feel substantially different using documented
tokens and semantic selectors without targeting Tailwind classes.

### Engineering success

- Controllers do not change when skins change.
- Controllers do not change when view packs change.
- OpenLint protects migrated surfaces.
- CSS customization does not require runtime JS.
- The skin plumbing has unit tests.
- Storybook demonstrates combinations.

## 19. Risks and mitigations

### Risk: CSS becomes too powerful and breaks layout

Mitigation:

- Raw CSS sanitizer.
- Scoped selectors only.
- Reject broad wildcard selectors.
- Keep layout-affecting root properties restricted.
- Marketplace stricter than local development.

### Risk: Tailwind visual utilities leak everywhere

Mitigation:

- OpenLint report-only rule first.
- Promote to error for migrated surfaces.
- CSS Modules for view-pack visual styles.

### Risk: semantic selector map is too small

Mitigation:

- Use SpacesOverview as a real CSS-guru test.
- Add hooks only where users actually need control.
- Document selector map per migrated surface.

### Risk: view packs duplicate behavior

Mitigation:

- Contracts define model/actions.
- OpenLint bans hooks in view files.
- Controller owns all mutation/navigation behavior.

### Risk: skins branch merge complexity

Mitigation:

- Port plumbing, do not wholesale merge UI.
- Rewrite per-voyage to global.
- Re-test core behavior after each port slice.

## 20. Immediate beads to create/update

`bd` is currently blocked in this worktree because the Dolt server is
unreachable and `dolt` is not on PATH. Once `bd` is usable, create/update these:

1. Architecture:
   - "Define whole-app UI customization architecture"
2. OpenLint:
   - "Add UI customization OpenLint scripts and migrated target manifest"
3. Skin core:
   - "Port global skin core plumbing from themes POC"
4. SpacesOverview:
   - "Make SpacesOverview skin-native with semantic slots"
5. Storybook:
   - "Build skin and view-pack Storybook lab"
6. Skin editor:
   - "Rewrite SkinEditor as UI-injection compliant surface"

## 21. Immediate next implementation step

Start with Phase 1:

1. Add npm scripts for environment-owned OpenLint UI fences.
2. Add a repo-owned migrated-target manifest.
3. Keep enforcement limited to `src/components/spaces-overview`.
4. Then begin Phase 2 by porting skin core tests first.

This keeps momentum while preventing the outdated skins branch from setting the
wrong architecture.
