# GC ↔ VK bridge migration sequencing

This document resolves `gc-gx1`: how the older Gas City-side MVP epic (`gc-2uh`) relates to the newer VD-owned integration epic (`gc-1rg`) and the Milestone 3/4 work now happening in `vibe-kanban-vscode-web`.

## Decision

The VD-owned integration is the target architecture. Treat the existing `gc-2uh` MVP as an implementation donor and compatibility reference, not as the long-term home for new bridge features.

In practice:

- **Finish only minimal compatibility work in `gascity`** when it is required to keep existing CLI/session-provider contracts stable.
- **Move new bridge behavior into VD** under `packages/gc-session-vibe` and the Gas City UI plugin/module.
- **Do not add new product-facing GC↔VK UX in the `gascity` repo.** The user-facing flow belongs in VD because VK workspaces and conversations are the primitive the user sees.
- **Keep the Gas City CLI as the orchestration engine** (`gc supervisor run`, `gc sling`, sessions, formulas), but let VD own generated runtime config, pack refs, workspace form modes, and bridge packaging.

## Relationship between epics

| Bead | Role after this decision | Notes |
| --- | --- | --- |
| `gc-2uh` — MVP: use Vibe Kanban as a Gas City exec session provider | Donor/reference epic | Use its contracts and any proven behavior as a source, then close remaining work once VD-owned package coverage exists. Avoid expanding scope here. |
| `gc-1rg` — Design follow-up: relocate GC↔VK integration into VD-owned headless package plus GC UI plugin | Target architecture epic | Owns bridge package, UI/plugin integration, packaging, and verification in this repo. |
| `gc-h30` — Milestone 3: Make GC-first orchestration work through VK workspaces | Product/workflow milestone | Builds the user-visible workspace creation/adoption/reviewer workflow on top of the VD-owned bridge. |
| `gc-bkj` — Milestone 4: Stabilize bridge packaging and verification | Hardening milestone | Ensures the relocated bridge is documented, tested, and smoke-verified without depending on Docker-only GC harnesses. |

## Recommended order of work

1. **Freeze `gc-2uh` feature growth.** Only land fixes that preserve existing behavior or unblock migration.
2. **Use `gc-2uh` as the donor for bridge semantics.** Preserve environment variable names and session state shape where they are already working:
   - `VIBE_BASE_URL`
   - `VIBE_REPO_MATCH`
   - `VIBE_TARGET_BRANCH`
   - `VIBE_EXECUTOR*`
   - `VIBE_ADOPT_WORKSPACE_ID`
   - `VIBE_ADOPT_SESSION_ID`
   - `VIBE_WORKING_DIR`
   - `VIBE_SESSION_LABEL`
   - `VIBE_STATE_ROOT` / `GC_EXEC_STATE_DIR`
3. **Implement/adapt in VD-owned `packages/gc-session-vibe`.** New behavior should be testable there first, then wired through VD UI/plugin actions.
4. **Expose user flows in VD, not Gas City docs/UI.** The New Workspace form offers plain VK, worker, and worker+review modes; the Gas City tab remains the operational view.
5. **Retire Docker-only GC verification paths after equivalent local-binary smoke exists.** The VD container now installs `gc` and supervises `gc supervisor run`; smoke should prefer that runtime.
6. **Close or defer leftover `gc-2uh` children only after mapping them to VD-owned tasks.** Do not duplicate normalized-log cleanup, adoption state, or documentation in both repos.

## Task disposition

| Task area | Disposition | Rationale |
| --- | --- | --- |
| Adopt existing VK workspace/session | **Move/finish in VD-owned bridge** | Required for New Workspace GC-backed modes and reviewer kickoff. |
| Create a new VK workspace from GC session start | **Keep in bridge package, but not the primary UX** | Useful for compatibility and headless flows; VD UI should usually create VK first. |
| Normalized log caching/cleanup from `gc-2uh.4` | **Finish or defer explicitly, but do not duplicate** | If needed by package tests, implement once in `packages/gc-session-vibe`; otherwise defer. |
| User-facing workspace mode UI | **VD only** | User starts from VK workspace concepts. |
| Generated city config/local packs | **VD/Springboard only** | Avoid mutating source-controlled `gascity` files. |
| Mock stack and scenario smoke | **VD-owned verification** | Should exercise the relocated package and installed local `gc` binary. |

## Duplication risks and guardrails

- **Risk: two bridges diverge.** Mitigation: keep `packages/gc-session-vibe` as the only active implementation target; treat Gas City-side code as reference unless a compatibility fix is unavoidable.
- **Risk: two user flows compete.** Mitigation: New Workspace/Add Tab is the front door; Gas City panel exposes operations/status, not a second separate product path.
- **Risk: generated config gets edited in `gascity`.** Mitigation: VD persists structured state and writes runtime TOML under user/runtime data paths only.
- **Risk: smoke tests require Docker-in-Docker.** Mitigation: prefer installed `/usr/local/bin/gc` plus supervised `gc supervisor run`; keep Docker harnesses only for explicit container integration coverage.

## Closeout criteria for the migration

The migration is complete when:

1. `packages/gc-session-vibe` owns the bridge behavior used by VD.
2. New Workspace GC-backed modes use the VD-owned bridge and local `gc` runtime.
3. Adopt-existing-workspace and reviewer kickoff paths are covered by tests/smoke.
4. Remaining `gc-2uh` children are either closed as superseded, completed in VD, or deferred with a specific reason.
