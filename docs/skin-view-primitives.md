# Skin-aware view primitives

`data-vd-*` attributes remain the DOM contract that global skins target. The
authoring model should not require every view file to hand-annotate every
element, though. Shared skin-aware primitives emit the common semantic hooks so
views can stay readable while skins keep stable selectors.

## Minimal API

- `VDHeading`: renders an `h1`-`h4` with `data-vd-text="primary"` by default.
- `VDText`: renders `span`, `p`, or `div` text with `primary`, `secondary`,
  `muted`, or status semantics.
- `VDAction`: renders a native `button` with `data-vd-component="button"` and
  optional `data-vd-tone`.
- `VDBadge`: renders a `span` with `data-vd-component="badge"` and optional
  `data-vd-status`.
- `VDCard`: renders a `div` with `data-vd-component="card"`.
- `VDRow`: renders a `div` or native `button` with `data-vd-component="row"`.
- `VDIcon`: renders an `svg` with a named `data-vd-icon`.

## When inheritance is enough

Use plain text when the surface or parent component already supplies the right
foreground through inheritance and the text is not a semantic exception. CI
should not require every text node to carry `data-vd-text`.

## When an explicit hook is required

Use a primitive or explicit `data-vd-*` hook when the element is:

- a stable surface, slot, or component boundary that skins should target;
- primary/secondary/muted text inside a component that sets its own foreground;
- a status, action tone, badge, icon, or other semantic exception;
- part of a reusable view-pack contract.

## CI implications

Milestone 4 checks should enforce outcomes, not annotation count:

- ban hardcoded foreground color utilities in skinned view files;
- keep controller/view boundaries clean;
- allow primitives and inherited foregrounds to satisfy the semantic contract;
- avoid requiring blanket `data-vd-text` attributes.

Run the combined local/CI boundary command with:

```sh
npm run lint:ui-customization
```

That command runs OpenLint's migrated view/controller and customization fence
presets, then runs the project-owned skinability check for migrated
SpacesOverview surfaces. The OpenLint policy used by this repo is committed in
`.github/openlint` so local and CI runs do not depend on a machine-global
policy directory. CI provisions the OpenLint CLI from the published
`@mickmister/openlint` npm package, which also brings the ast-grep dependency
needed by the repo-owned policy.
