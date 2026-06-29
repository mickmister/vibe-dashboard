# Voyage navigation model

This document records the approved navigation terminology and URL contract for
the voyage-centric workspace model.

## Terminology

- **Voyage**: a saved browsing/work session.
- **Craft**: the reusable workspace bundle formerly called a tab group. A craft
  can contain agent, code-server, app, docs, or other views.
- **VoyageEntry**: code-only implementation detail for one craft embarked in one
  voyage. Do not show this term in product copy; use wording like “embark this
  craft in this voyage”.
- **View**: one iframe destination inside a craft.
- **Space**: the home galaxy/location where craft can be found in the app.

## Persistent state

Voyages are stored in `workspace-sessions` persistent state as
`SavedWorkspaceSession` records.

Each voyage has:

- `id`: stable, opaque identifier used for identity.
- `slug`: editable human-readable slug with the stable id suffix.
- `activeVoyageEntryId`: the active craft instance inside the voyage.
- `voyageEntries`: ordered craft instances in the voyage.

Each `VoyageEntry` has:

- `id`: stable identifier for this embarked craft instance.
- `tabGroupId`: stable craft identifier.
- `viewIds`: ordered active view IDs for single-view or split-view restoration.

## Compatibility naming in persisted state

The codebase now exposes `View`, `ViewPair`, and `Craft` type names for new
navigation work. The persisted workspace JSON still uses the historical field
names `tabs`, `pairs`, `tabGroups`, and `tabGroupIds` so existing data can load
without a migration. The legacy TypeScript aliases `Tab`, `TabPair`, and
`TabGroup` remain deprecated compatibility aliases; new code should prefer
`View`, `ViewPair`, `Craft`, and `VoyageEntry`.

The stable id suffix is the final `_`/`-` delimited segment of the stable id.
Human-readable labels can change, but URL resolution remains stable because the
suffix stays present.

## Canonical URLs

Canonical voyage URLs use `/dashboard` with query params:

```text
/dashboard?voyage=my-voyage-111&craft=my-craft-222-333&views=agent-444,code-555
```

- `voyage=` is `<editable voyage label slug>-<voyage id suffix>`.
- `craft=` is `<craft label slug>-<craft id suffix>-<voyage entry id suffix>`.
- `views=` is a comma-separated ordered list of
  `<view label slug>-<view id suffix>` tokens.

There is intentionally no `layout=` param yet. Until multiple layout modes
exist, a split is represented by the ordered `views=` list. Layout-specific
metadata, such as split sizing, should live on voyage-entry state when needed
rather than introducing durable pair IDs into the URL.

## Shareability and redirects

Voyage URLs are intended to be shareable across users who can access the same
workspace state. Unknown or stale slugs should degrade to a safe fallback voyage
instead of crashing.

Legacy URLs of the form:

```text
/dashboard/spaces/:spaceId/:tabGroupId/:itemId
```

remain compatibility inputs and should redirect with `replace` to the canonical
voyage URL once their space, craft, and view selection has been resolved.

## Rename and uniqueness behavior

Voyage slugs are editable. Renaming a voyage should update only the
human-readable slug prefix while keeping the stable id suffix. Links containing
older slug prefixes can be resolved by stable suffix where possible and then
redirected to the current canonical slug.

Craft and view labels are also human-readable URL prefixes. Identity comes from
stable id suffixes, not label text.

If suffixes ever collide, the resolver should prefer an exact full id match when
available, then fall back to suffix matching. Future generated IDs should remain
monotonic enough that suffix collisions are exceptional.

## Duplicate craft behavior

Opening a craft that already exists in the current voyage or another voyage
should not silently dedupe forever. The UI should tell the user where the craft
is already embarked and ask whether to:

1. Switch to the existing embarked craft.
2. Embark another instance of the craft in this voyage.
3. Open or switch to another voyage that already contains it.

The UI must not say “VoyageEntry”; product copy should use “embark the craft”.
