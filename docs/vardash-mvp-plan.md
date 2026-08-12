# vardash focused MVP plan

## Goal

`vardash` is a repo-scoped environment value manager for VD/VK devboxes. The goal is to do materially better than `.env` files without trying to become a state-of-the-art secrets manager:

- users manage values through UI instead of hand-editing plaintext files;
- secrets are not stored in repo/worktree files in predictable locations;
- workspaces with multiple repos can launch each repo's processes with only that repo's env;
- agents do not receive vardash secrets in normal session env;
- Varlock is used where it helps with validation/redaction, but vardash remains source of truth.

Production VD UI access is through the built-in Settings tab for
workspace-backed crafts. The Vardash settings menu receives explicit workspace
context, requires a selected workspace repo, and uses workspace-scoped API routes
for UI-facing reads and mutations. Direct `/dashboard/vardash` navigation and
repo-row Vardash links are not part of the production entry model.

## Threat model

Vardash is a better-than-`.env` developer convenience and safety layer, not a full isolation boundary.

Vardash is intended to protect against:

- accidental plaintext secret files in repos/worktrees, including predictable `.env` locations;
- normal coding-agent/session environment leakage, because vardash values are not added to ordinary agent/session env;
- UI/API secret recall, because secret values are write/replace only and metadata-only on read paths.

Vardash is not intended to protect against:

- root access, unrestricted sudo, or full devbox/container compromise;
- the launched process intentionally or accidentally exfiltrating secrets it was explicitly given;
- `/proc` environment inspection or same-user process isolation issues unless separate OS/container hardening is implemented.

Security-sensitive docs and UI should avoid implying stronger guarantees than this model.

## Scope decisions

### Repo-owned values, workspace-repo selections

Saved values are owned by a repo. Active selections are scoped to a specific workspace repo, with optional repo defaults.

Do **not** use a single repo-global active selection for MVP because it can unexpectedly affect other workspaces using the same repo.

Initial model:

```ts
type RepoEnvKey = {
  id: string;
  repoId: string;
  key: string;
  kind: 'secret' | 'plain';
  required: boolean;
  description?: string;
};

type RepoEnvSavedValue = {
  id: string;
  repoId: string;
  envKeyId: string;
  name: string;
  // Stored encrypted/persisted by the store implementation.
  valueRef: string;
};

type RepoEnvDefaultSelection = {
  repoId: string;
  envKeyId: string;
  savedValueId: string | null;
};

type WorkspaceRepoEnvSelection = {
  workspaceId: string;
  repoId: string;
  envKeyId: string;
  savedValueId: string | null;
};
```

Resolution precedence:

```text
repo default selection < workspace-repo selection < explicit launch override
```

### Secret recall boundary

Secret values are write/replace only for MVP.

- List/read APIs return metadata only for secret keys.
- Write/replace APIs may accept plaintext, but return metadata only.
- There is no secret reveal endpoint for MVP.
- This must be enforced in server/actions, not only by hiding UI controls.

Plain variables may be returned normally.

### Imports

- Pasted `.env` content defaults imported values to `secret`.
- Users may explicitly mark imported keys as plain.
- `.env.sample`, `.env.example`, and similar templates seed keys and required metadata only; they must not import values as saved values.

### Varlock

Varlock is an optional launch-time validation/redaction wrapper for MVP, not the resolver or source of truth.

Before depending on it, do a small spike proving:

- generated ad hoc schema contains no values;
- command assembly is shell-safe;
- `--inject vars` or equivalent avoids serialized value blobs;
- failure messages are useful enough for VD UI.

### Storage

Do a SQLCipher/native package spike before storage implementation. Then implement **vkvw-d7ad.8 — Implement vardash encrypted store and migrations** before the metadata-only API boundary. All callers must go through a `vardash-store` interface so storage can change without affecting resolver, API, UI, or launch code.

Do not ship plaintext SQLite as the default. If a plaintext adapter is useful for tests, it must be explicitly non-production/test-only.

### Launch and agents

Vardash secrets enter only explicit vardash launches. They must not be merged into normal coding-agent/session `ExecutionEnv`.

For a workspace containing multiple repos, each repo process receives only the env resolved for that repo/worktree.

Launch planning builds a minimal child environment from an allowlist of baseline
process variables plus the selected repo's resolved vardash env. Normal
agent/session env construction does not merge vardash env values. Optional
Varlock wrapping is applied only to explicit vardash launches and remains a
validation/redaction wrapper, not the source of truth. The runtime Varlock
binary/schema location are server-controlled, generated schema files omit
user-provided descriptions/comments, and unavailable Varlock fails requested
Varlock launches with sanitized errors while non-Varlock launches continue.

### Process scope

The full vardash UI/launch workflow implements repo process definitions,
explicit launch preparation/execution, and minimal Launch/Status/Stop controls
while preserving legacy `Repo.dev_server_script` compatibility. First-class
tmux lifecycle/logging/UI/inspection remains deferred.

Legacy compatibility target:

- existing `dev_server_script` can be represented as a default repo process definition;
- current users can still start existing dev scripts;
- new model can support multiple named process definitions per repo.
- process definition APIs persist/return launch metadata;
- explicit vardash launch APIs are the only raw-env execution path;
- launch execution preserves legacy `sh -lc <command>` semantics by passing the
  command as one argv item and never concatenating env/user fragments into shell
  strings;
- process status exposes run id, status, and exit code only;
- stop sends SIGTERM; restart is out of scope;
- stdout/stderr capture, tmux lifecycle, log streaming, and inspection remain
  deferred.

### UI scope

UI work must go through UX Pilot first via bead **vkvw-24c5 — Design vardash UI surfaces with UX Pilot**.
The MVP UI design brief is captured in `docs/vardash-ui-design.md`.

The UI communicates:

- repo-owned saved values;
- workspace-repo active selections;
- secret values cannot be read back after saving;
- pasted `.env` values default to secret;
- sample/template imports seed keys only;
- Varlock status/errors when enabled;
- explicit vardash launches are repo-scoped and normal agent/session env is not modified;
- launch UI is limited to Launch/Status/Stop with no restart, raw env preview,
  stdout/stderr, tmux, log inspection, or secret reveal.

## Acceptance tests to bake into first milestones

### Resolver

- Workspace-repo selection overrides repo default.
- Repo default is used when workspace-repo selection is unset.
- A workspace-repo selection row with `savedValueId: null` means "inherit the
  repo default" for MVP; it does not mean "force no value".
- Required keys with no resolved value are reported.
- Secret metadata excludes raw values.

### Import

- Handles quotes, comments, empty values, and common dotenv syntax.
- Pasted `.env` values default to secret.
- `.env.sample` / `.env.example` seeds keys without values.

### API/action boundary

- List APIs never return secret plaintext.
- Replace-secret action returns metadata only.
- No secret reveal endpoint exists for MVP.

### Launch

- Each repo process receives only that repo's resolved env.
- Normal agent/session env excludes vardash secrets.
- Missing required values block launch with actionable errors.

### Varlock spike

- Generated schema contains no values.
- Command assembly is shell-safe.
- Varlock remains optional; launch still works without it.

### UI

- Secret values cannot be read back after save.
- Plain values are visibly distinct from secret values.
- Workspace-repo selections do not imply global repo changes.

## Deferred

- Named sets and composable presets.
- Cross-repo sharing.
- Secret reveal UI/API.
- First-class tmux process lifecycle and inspection.
- Vaultwarden/Infisical/OpenBao integration as primary storage.
