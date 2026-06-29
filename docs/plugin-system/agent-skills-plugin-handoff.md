# Handoff: VD plugins installing agent skills through `npx skills`

## Goal

Add first-class support for VD plugins to install agent skills, and define a set
of built-in VD skills in this repo that are installed through the same
`npx skills` mechanism.

The important product constraint is: **do not copy skill folders directly into
agent homes as a bespoke VD behavior**. The installer should call the public
`skills` CLI (`npx skills ...`) so VD uses the same skill package/install
semantics agents already understand.

Current CLI facts verified locally:

```bash
npm view skills name version bin description --json
npx -y skills --help
```

`skills@1.5.13` exposes:

- `skills add <package>` / `add-skill`
- `skills remove [skills]`
- `skills list`
- `skills experimental_install` from `skills-lock.json`
- `skills experimental_sync`
- useful install flags: `--global`, `--agent <agents>`, `--skill <skills>`,
  `--all`, `--yes`, `--copy`

## Current state in this repo

There is no first-class plugin skill feature today.

Relevant existing plugin schemas:

- `plugins/orchestrator/manifest.ts`
  - supports `frontend`, Deno components, containers, services, MCP, storage,
    secrets, health checks, lifecycle
  - has no `agentSkills` component and no agent-skill capability model
- `plugins/orchestrator/plugin-service-orchestrator.ts`
  - supports release assets, archive/file materialization, package-manager tool
    installs, `bin` symlinks, Supervisor services, and Caddy exposure
  - has no managed skill install/remove flow

A trusted instance plugin can currently abuse `postExtract.admin-script` to run
shell and write to `/home/vkuser/.codex` or `/home/vkuser/.claude`, but that is
not acceptable as the real feature because it is not declarative, auditable,
idempotent, or uninstallable.

## Proposed UX

Plugin authors declare skills in plugin metadata. VD stages/verifies plugin
artifacts as usual, then reconciles desired skills by calling `npx skills`.

Built-in VD skills should also live in this repo and be installed through the
same reconciler so built-ins and marketplace/instance plugins exercise one code
path.

Example operator expectations:

```bash
# Reconcile plugin runtime and skills after instance config changes.
/usr/local/bin/vd-plugin-reload.sh

# Skills from enabled plugins are available to supported agents.
npx -y skills list --global --agent '*'
```

## Proposed manifest shape

Add a component to the sandbox-first manifest contract:

```ts
export interface PluginComponents {
  // existing fields...
  agentSkills?: AgentSkillContribution[];
}

export interface AgentSkillContribution {
  id: string;
  title?: string;
  /** Path inside the verified plugin artifact that is a skills package/root. */
  source: string;
  /** Agent selectors passed to `skills add --agent`; default `*`. */
  agents?: string[];
  /** Skill names passed to `skills add --skill`; default `*`. */
  skills?: string[];
  /** Install globally for the vkuser account. Default true for container runtime. */
  scope?: 'global' | 'project';
  /** Prefer `--copy` for immutable verified plugin artifacts. Default true. */
  copy?: boolean;
}
```

For the service-catalog runtime (`PluginServiceDefinition`) add equivalent
metadata if needed, or translate service-catalog entries into the manifest model
before reconciliation. Avoid inventing two unrelated skill schemas.

Possible JSON:

```json
{
  "components": {
    "agentSkills": [
      {
        "id": "vd-plugin-ops",
        "source": "skills/vd-plugin-ops",
        "agents": ["*"],
        "skills": ["*"],
        "scope": "global",
        "copy": true
      }
    ]
  }
}
```

## Installation command contract

The reconciler should call `npx skills`, not hand-copy files.

Initial install command shape:

```bash
npx -y skills add <verified-skill-package-path> \
  --global \
  --agent '*' \
  --skill '*' \
  --copy \
  --yes
```

For selected skills/agents:

```bash
npx -y skills add <verified-skill-package-path> \
  --global \
  --agent claude-code codex \
  --skill vd-plugin-ops beads-web-plugin-refresh \
  --copy \
  --yes
```

Removal/disable flow should use the CLI too. Verify exact best syntax during
implementation; likely shapes are:

```bash
npx -y skills remove <skill-name> --global --agent '*' --yes
# or
npx -y skills remove --global --agent '*' --skill <skill-name> --yes
```

Do not rely on undocumented output formats except where `--json` exists.

## Built-in VD skills to add

Create a repo-local skill package, for example:

```text
agent-skills/
  vd-plugin-ops/
    SKILL.md
  vd-plugin-authoring/
    SKILL.md
  beads-web-plugin-refresh/
    SKILL.md
  vd-instance-config/
    SKILL.md
```

Suggested built-ins:

1. `vd-plugin-ops`
   - how to inspect `/var/lib/vd/instance-config/plugins.json`
   - use `vd-plugin-reload.sh`
   - inspect Supervisor/Caddy generated plugin resources
   - avoid manual `supervisorctl stop` as durable disablement
2. `vd-plugin-authoring`
   - author instance plugin JSON
   - choose installer/materializer/service/Caddy exposure shape
   - calculate sha256 and validate release assets
3. `beads-web-plugin-refresh`
   - migrate the existing `.claude/skills/beads-web-plugin-refresh/SKILL.md`
     content into the repo-local package
   - prefer the CLI refresh flow added in this branch
4. `vd-instance-config`
   - committing/pushing `/var/lib/vd/instance-config`
   - what is config vs runtime/cache/data under `/var/lib/vd`

Install built-ins with the same `npx skills` path. Two plausible approaches:

### Option A: install built-ins at image build time

Add the skills package to the image and run:

```bash
npx -y skills add /opt/vibe-kanban-vscode-web-seed/agent-skills \
  --global --agent '*' --skill '*' --copy --yes
```

Pros: built-ins are ready on first boot.  
Cons: image build uses npm/network unless the `skills` package is pinned in repo
or otherwise cached.

### Option B: reconcile built-ins at startup/reload

Have `vd-plugin-reload.sh` or a sibling `vd-agent-skills-reload.sh` run a
built-in skill reconcile step:

```bash
npx -y skills add /opt/vibe-kanban-vscode-web-seed/agent-skills \
  --global --agent '*' --skill '*' --copy --yes
```

Pros: same runtime path as plugins; easier to update with a reseeded runtime.  
Cons: startup/reload may need network unless `skills` is already available.

Recommendation: add `skills` as a pinned package dependency/devDependency and
invoke it through `npm exec -- skills ...` or `npx -y skills@<pinned> ...` so the
version is deterministic.

## Runtime design

Add a small reconciler module rather than burying this in shell scripts.

Candidate files:

```text
plugins/orchestrator/plugin-skill-orchestrator.ts
plugins/orchestrator/plugin-skill-orchestrator-cli.ts
plugins/orchestrator/plugin-skill-orchestrator.test.ts
```

Inputs:

- composed plugin catalog/manifest data
- enabled/disabled plugin states
- verified plugin install paths
- built-in skill package path
- target scope/agents
- command runner abstraction for tests

Outputs:

- dry-run plan: skills to add/remove/update
- apply results: commands run, stdout/stderr summaries, failures
- persisted audit state under `/var/lib/vd`, e.g.

```text
/var/lib/vd/agent-skills/installed.json
```

Track enough state to make disable/uninstall deterministic:

```json
{
  "installed": [
    {
      "pluginId": "vd.beads-web",
      "pluginVersion": "v0.11.6",
      "skillId": "beads-web-plugin-refresh",
      "agents": ["*"],
      "scope": "global",
      "sourcePath": "/var/lib/vd/plugins/vd.beads-web/v0.11.6/extracted/skills"
    }
  ]
}
```

## Security and policy

Agent skills are prompt/instruction extensions. Treat them as capability-bearing
even though they are “just markdown”. They can steer agents toward shell
commands, network access, secrets, or repo writes.

Minimum policy:

- Marketplace plugins must explicitly declare `components.agentSkills`.
- Admin review should show skill names, source plugin, target agents, and a
  short description from each `SKILL.md` frontmatter/body.
- Skill install should only occur after artifact verification and plugin approval.
- Use `--copy` by default so installed skills do not symlink into mutable plugin
  install directories unless that behavior is intentionally desired.
- Removing/disabling a plugin should remove skills that were installed solely by
  that plugin.
- If two plugins provide the same skill name, fail closed or namespace names.
- Avoid granting arbitrary filesystem writes just to install skills; the
  orchestrator owns skill installation.

## Acceptance criteria

1. Manifest validation accepts `components.agentSkills` and rejects malformed
   entries.
2. A plugin with an enabled `agentSkills` contribution produces a dry-run plan
   containing an `npx skills add ...` command.
3. Apply mode invokes `npx skills` through an injectable command runner.
4. Re-running apply is idempotent enough for repeated `vd-plugin-reload.sh`.
5. Disabling/removing a plugin invokes `npx skills remove ...` for skills owned
   only by that plugin.
6. Built-in repo skills are installed through the same code path, not copied
   manually.
7. Tests cover:
   - manifest validation
   - add command rendering
   - remove command rendering
   - built-in skill install plan
   - disabled plugin removes/omits skills
   - duplicate skill conflict behavior
8. Operator docs mention:
   - how to list installed skills
   - where built-in skills live in the repo
   - how plugin-provided skills are approved/reconciled

## Implementation notes / gotchas

- Verify local directory support with `npx skills add <local-path> --list` before
  locking in the package layout.
- The container persists `/home/vkuser/.claude` and `/home/vkuser/.codex` in
  Docker volumes, so global installs should survive container recreation.
- `/var/lib/vd` is also persistent; store reconciler state there, not in the
  image filesystem.
- This feature should be separate from plugin `postExtract`; postExtract remains
  artifact setup, while skill install is host/agent integration.
- Do not make skill installation depend on Caddy/Supervisor success; report it
  as a separate reconcile phase so failures are diagnosable.
- Consider adding a user-facing wrapper command later:

  ```bash
  vd-agent-skills-reload.sh
  ```

  and have `vd-plugin-reload.sh` call it after plugin artifacts are materialized.
