# vkvw-9yay.6 — Storybook view-pack and skin coverage plan

## Scope

Milestone 6 proves a minimal, reusable SkinLab Storybook convention for migrated
UI customization surfaces. It should not rewrite all Storybook stories.

## Acceptance checks

- `SKINLAB-001`: migrated surfaces can opt into a typed story matrix with
  state, skin, view-pack, and density dimensions.
- `SKINLAB-002`: generated story objects carry state fixtures and skin/density
  controls or metadata that makes the active variant explicit in Storybook.
- `SKINLAB-003`: `SpacesOverview` uses the convention for default, alternate
  skin, alternate view-pack, composed skin/view-pack, and mobile density proof.
- `SKINLAB-004`: `SkinEditorDialog` uses the convention as the second migrated
  UI customization surface without production app wiring.
- `SKINLAB-005`: existing design-direction explorations are intentionally
  preserved as reference stories, not silently deleted.

## Validation commands

```sh
npm test -- src/stories/skinLab.test.ts
npm run check-types
npm run lint:ui-customization
npm run build-storybook
npm test
npm run build
```
