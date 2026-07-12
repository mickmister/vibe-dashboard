# vardash UI design brief

Bead: **vkvw-24c5 — Design vardash UI surfaces with UX Pilot**

> Note: no UX Pilot connector is available in this workspace. This document is structured as a UX Pilot-ready design brief/prompt plus product decisions so the next UI implementation can use UX Pilot without re-opening security or scope questions.

## Design goals

- Help users do better than `.env` files without positioning vardash as a full enterprise secrets manager.
- Keep mental model repo-scoped: env keys, saved values, defaults, and process definitions belong to a repo.
- Make workspace-repo selections explicit: changing a workspace selection must not feel like changing global repo state.
- Make secret non-recall obvious: users can save/replace secrets but cannot reveal them later.
- Support multi-value saved values for the same env key, e.g. multiple client ID/secret pairs.
- Keep process launch UX explicit so secrets only enter vardash launches.
- Show Varlock as optional validation/redaction status, not as source of truth.
- Avoid tmux/live process inspection scope in MVP UI.

## Non-goals for MVP UI

- No secret reveal UI.
- No cross-repo secret sharing.
- No named sets/composable presets yet.
- No tmux lifecycle/log streaming/inspection UI.
- No raw resolved env preview because it would reveal secrets.
- No UI affordance that encourages users to put secret material in descriptions.

## Primary navigation shape

Add a workspace/repo-scoped vardash surface that can be reached from repo or workspace detail context.

Recommended information architecture:

1. **Repo env** tab
   - Env keys table
   - Saved values drawer/panel per key
   - Repo default selection column
   - Workspace selection override column when opened in workspace context
2. **Import** tab/action
   - Paste `.env` or `.env.sample/.env.example`
   - Dry-run preview before apply
   - Conflict list and safe apply button
3. **Processes** tab
   - Repo process definitions
   - Legacy Dev server marker
4. **Launch settings/status** panel
   - Missing required values
   - Varlock enabled/disabled and validation errors
   - Reminder that secrets only go to explicit vardash launches
   - Explicit Launch/Status/Stop controls
   - No restart, raw env preview, stdout/stderr, tmux, or log inspection

## Screen 1: repo env overview

Purpose: let users see required keys, kind, saved-value count, repo default, and workspace override without exposing secret values.

Wireframe:

```text
Vardash / Repo: vibe-dashboard                          [Import] [Add key]
----------------------------------------------------------------------------
Scope: Repo values                                         Workspace: ws-123
Secrets are write-only. Saved secret values cannot be revealed after saving.

Key              Kind      Required  Saved values  Repo default   This workspace
API_TOKEN        Secret    Yes       2             prod           local-dev
PORT             Plain     Yes       1             local          inherit repo
CLIENT_ID        Plain     Yes       2             dev-client     staging-client
CLIENT_SECRET    Secret    Yes       2             dev-secret     staging-secret
OPTIONAL_FLAG    Plain     No        0             unset          inherit repo

[Select row]
```

Row behavior:

- Secret rows never show value text.
- Plain rows may show selected plain value in the saved values panel, not inline by default.
- “inherit repo” means no workspace-specific selected value. If a workspace selection row has `savedValueId: null`, MVP semantics are still inherit repo default; do not label it as disabled.
- Missing required values should show a clear badge: “Required · no value selected”.

## Screen 2: saved values panel

Purpose: allow multiple named values for one env key and toggling selections.

Wireframe for secret key:

```text
API_TOKEN                                                     Secret · Required
----------------------------------------------------------------------------
Description
[Optional description. Do not include secret material.]        [Save]

Saved values
Name            Value status        Repo default    Workspace ws-123
prod            Secret saved        selected        -
local-dev       Secret saved        -               selected
staging         Secret saved        -               -

[Add saved value]
[Replace selected value]

Secret values are not recallable. Replacing a value overwrites it without showing
its previous content.
```

Wireframe for plain key:

```text
PORT                                                          Plain · Required
----------------------------------------------------------------------------
Saved values
Name            Value          Repo default    Workspace ws-123
local           3000           selected        inherit repo
storybook       6006           -               -
```

Important UX rules:

- Secret add/replace inputs use password-style fields with optional “show while typing” only before save. After save, do not display it again.
- Replace secret flow must say “Existing value cannot be displayed. Paste a replacement.”
- Plain values are visually distinct with a “Plain” badge and can be read back.
- Do not provide “copy secret” or “reveal secret”.

## Screen 3: import flow

Purpose: import pasted `.env` values safely and seed `.env.sample` metadata without partial mutation.

Flow:

1. Choose import type:
   - “Paste `.env` values” — values default to Secret.
   - “Paste `.env.sample` / `.env.example`” — seeds keys only; no values saved.
2. Paste content.
3. Dry-run preview.
4. Resolve conflicts.
5. Apply.

Wireframe:

```text
Import env configuration
----------------------------------------------------------------------------
Import type
(*) Paste .env values              Values default to Secret
( ) Paste .env.sample/.env.example Creates required keys only; no values saved

Saved value name: [local paste]

[ pasted content editor ]

[Preview]
```

Preview state:

```text
Preview import                                                      [Apply]
----------------------------------------------------------------------------
Key             Kind      Required  Action
API_TOKEN       Secret    Yes       Create key + saved value "local paste"
PORT            Plain     Yes       Create key + saved value "local paste"
EMPTY           Secret    Yes       Create key + saved value "local paste"

Conflicts
- TOKEN: cannot change existing Secret key with saved values to Plain.
- API_TOKEN: saved value name "local paste" already exists.
- Duplicate key in pasted import: API_TOKEN.

No changes are applied until conflicts are resolved.
```

Conflict behavior:

- Duplicate keys in one import block apply.
- Existing saved-value name conflicts block apply for `.env` value imports.
- Secret-to-plain with existing values blocks apply for all import types.
- Parser diagnostics must not echo malformed raw text, because users can paste secrets accidentally.

## Screen 4: repo process definitions

Purpose: show launchable repo processes without implementing tmux/logging UI yet.

Wireframe:

```text
Processes / Repo: vibe-dashboard                                  [Add process]
----------------------------------------------------------------------------
Name          Command          Source                    Default   Actions
Dev server    npm run dev      Legacy dev_server_script  Yes       Edit
Worker        npm run worker   Manual                    No        Edit
Storybook     npm run storybook Manual                    No        Edit

Legacy dev_server_script imported as default "Dev server".
Process execution uses explicit vardash launch isolation. Live tmux/log inspection
is deferred.
```

Process edit rules:

- Generic process creation should default source to Manual.
- Legacy source should appear only when imported from `dev_server_script`.
- Command field keeps existing dev-script semantics. Future execution code must avoid concatenating user/env-derived fragments into shell command strings.
- Mark exactly one default per repo.

## Screen 5: launch readiness and status panel

Purpose: show whether a selected repo/process can be launched and controlled,
without exposing raw secrets or process logs.

Wireframe:

```text
Launch readiness: Dev server / Repo vibe-dashboard
----------------------------------------------------------------------------
Status: Blocked

Missing required values
- API_TOKEN Secret required, no selected value
- CLIENT_SECRET Secret required, no selected value

Provided values
- PORT Plain selected: local
- CLIENT_ID Plain selected: dev-client
- CLIENT_SECRET Secret selected: staging-secret (value hidden)

Varlock
Enabled: Optional validation wrapper
Schema: metadata only
Last validation: not run

[Open Env setup] [Launch disabled]
```

When ready:

```text
Status: Ready
This launch will receive only env values for repo vibe-dashboard.
Normal agent/session env is not modified.
[Launch]
```

After launch:

```text
Launch status
----------------------------------------------------------------------------
Run id: run_abc123
State: running
Exit code: n/a

[Stop]

No stdout/stderr or live logs are exposed here.
```

Lifecycle rules implemented for MVP:

- UI exposes Launch, Status, and Stop only.
- Restart is out of scope; users can stop and launch again.
- Status polling refreshes while a run is starting/running/stopping and stops
  when the run is stopped/failed.
- Status and errors are generic and secret-safe; they do not include raw env,
  stdout/stderr, or captured logs.
- Varlock readiness mirrors server-controlled runtime policy. Requested Varlock
  that is disabled or unavailable blocks readiness with generic status.

## UX copy library

Use consistent copy:

- “Secret values are write-only. You can replace them, but vardash will not show them again.”
- “Workspace selection affects only this workspace + repo.”
- “Inherit repo default” not “unset” when workspace selection has no saved value.
- “Varlock validates/redacts at launch. vardash remains the source of truth.”
- “Do not put secret material in descriptions.”
- “No changes are applied until conflicts are resolved.”

## Accessibility and safety notes

- Badges must not rely on color alone: label as Secret/Plain, Required/Optional, Default/Workspace.
- Confirm destructive-looking actions such as replacing a secret.
- Import preview must be keyboard navigable and screen-reader friendly.
- Secret input visibility toggle should only affect unsaved input.
- Avoid copying raw command/env snippets that include values.

## UX Pilot prompt

Paste this into UX Pilot to generate the MVP UI mockups:

```text
Design a low-risk MVP UI for "vardash", a repo-scoped devbox environment value manager inside a developer dashboard.

Context:
- Users manage env keys per repository.
- Each key is Secret or Plain and Required or Optional.
- Secret values are write-only: users can save/replace but cannot reveal/copy/read them later.
- Plain values can be read back.
- Each env key can have multiple named saved values.
- Repo default selections apply unless a workspace-repo selection overrides them.
- Workspace selection scope is workspace + repo only; it must not look global.
- A workspace selection with no saved value means "inherit repo default" for MVP.
- Users can import pasted .env values; pasted values default to Secret.
- Users can import .env.sample/.env.example; samples create required key metadata only and no values.
- Import must have dry-run preview, conflicts, and no partial apply.
- Conflicts: duplicate keys, saved value name exists for .env values, and secret-to-plain with existing saved values.
- Users manage multiple repo process definitions. Legacy Repo.dev_server_script imports as default "Dev server" with source "legacy_dev_server_script".
- Do not design tmux lifecycle/log streaming/live inspection yet.
- Varlock is optional launch-time validation/redaction; vardash remains source of truth.
- Launch readiness should show missing required values and selected metadata without raw secret values.
- Normal coding-agent/session env must not receive vardash secrets; secrets only enter explicit vardash launches.

Create screens for:
1. Repo env overview table.
2. Saved values detail panel for a Secret key and a Plain key.
3. Import flow with dry-run preview and conflicts.
4. Process definitions list/edit with legacy Dev server marker.
5. Launch readiness panel with Varlock status.

Style:
- Developer dashboard SaaS UI.
- Dense but readable tables.
- Security-conscious copy.
- Clear badges for Secret/Plain, Required/Optional, Repo default/Workspace override.
- Do not include any UI that reveals or copies secret values.
```

## Implementation handoff checklist

Before implementing UI code:

- Use the metadata-only API boundary from `src/server/vardash/api.ts`.
- Do not add secret reveal endpoints.
- Do not call launch resolver from metadata UI in a way that exposes raw `env` values.
- Import UI must call dry-run/preview first and handle conflicts before apply.
- Use typed vardash client/hooks for env, import, process, readiness, launch,
  status, and stop APIs. Do not hand-roll fetch shapes in UI.
- Process execution UI remains limited to explicit vardash Launch/Status/Stop.
  Do not add tmux/log inspection or stdout/stderr display without a new scope bead.
- Route any visual design iteration through UX Pilot output and keep this document as the security/scope source of truth.

## Implementation note: workspace entry point and readiness gating

The first production entry point is `/dashboard/vardash?workspaceId=...&repoId=...&repoName=...`, linked from each repo shown in the dashboard workspace row. The route renders the repo env manager, import flow, process definition manager, and Launch/Status/Stop panel for that workspace+repo only.

UI-facing vardash calls must use workspace-scoped API routes so workspace/repo ownership is validated before metadata reads or mutations. Repo-only vardash routes are disabled by default and require an explicit server opt-in for internal/admin use. Launch readiness is intentionally ineligible when the server cannot safely resolve a repo root for the selected workspace repo; the UI must not show a ready state for launches that would fail due unresolved repo root.
