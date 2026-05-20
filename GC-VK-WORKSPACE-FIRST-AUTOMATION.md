# GC + VK Workspace-First Automation Plan

## Status

Draft implementation target for the VK-first / GC-all-in-automation direction.

## Summary

We are choosing a **VK-first workspace model** with **Gas City as the long-running orchestration layer**.

### Core split

- **Vibe Kanban (VK)** owns:
  - top-level workspace creation
  - worktree/container root lifecycle
  - repo checkout bootstrap
  - coding-agent execution substrate
  - session UI and session naming

- **Gas City (GC)** owns:
  - long-running control-plane orchestration
  - agent/session fleet lifecycle
  - work routing and sling behavior
  - formulas, review legs, mail, waits, and patrol loops
  - task-level worktree orchestration inside the VK workspace

- **Vibe Dashboard (VD)** owns:
  - simplified user-facing workflow UX
  - GC/VK integration entrypoint
  - workspace creation and workflow mode selection
  - operator dashboard for crew/work/inbox/workspace

---

## Decision highlights

### 1. GC should be used in automation mode

We are not treating GC as a thin CLI helper.

We are assuming:

- GC should run as a **long-lived supervised service**
- GC should be able to drive autonomous or semi-autonomous work orchestration
- GC should manage sessions, work routing, review flows, and background coordination

This means the VD container should ultimately run GC in **daemon/control-plane mode**.

### 2. VK should stay the workspace owner

GC should **not** create a new VK workspace for every task.

That would cause:

- too many workspaces
- too much lifecycle overhead
- too much operator/UI clutter
- poor fit for task-level automation

Instead:

- one VK workspace is the top-level development arena
- GC may create multiple task-level Git worktrees inside that workspace

### 3. VK sessions remain the LLM execution entrypoint

We want to keep using VK sessions as the actual coding-agent entrypoint.

GC should orchestrate:

- what session is created
- what task/worktree it is assigned to
- what reviewer/worker/coordinator role it plays
- when it is nudged, reviewed, interrupted, or drained

### 4. Use VK `working_dir` for GC task worktrees

Prompt-only directory targeting is acceptable as a fallback, but the preferred implementation is to use VK's existing `working_dir` support.

This gives us a stronger and clearer mapping between:

- GC task worktree
- VK session working directory
- crew role / task identity

### 5. Use human-friendly session names

GC-managed VK sessions should be renamed to human-friendly labels, for example:

- `Worker • Auth Refactor`
- `Reviewer • Auth Refactor`
- `Planner • Notifications`

Structured identifiers should remain in metadata/state rather than in the visible display label.

### 6. Stop relying on Docker-in-Docker for the GC effort

The old GC compose harness helped clarify architecture, but Docker-in-Docker is too unreliable for this environment.

So for this effort:

- install Gas City directly in the main VD container
- remove GC-specific runtime dependence on nested Docker
- prefer direct-container or host-run verification paths instead of compose-heavy DinD flows

---

## User-facing workflow model

### Entry point

VD should present a workspace-first creation UX.

The user should start from a simplified **New Workspace** flow based on VK concepts:

- repository
- branch source
- coding agent choice
- prompt
- workflow mode

### Workflow modes to support first

#### A. Plain VK workspace

- create workspace
- no GC orchestration attached yet

#### B. GC-managed worker in VK workspace

- create workspace
- bind GC to workspace
- create one GC-managed worker session

#### C. GC worker + reviewer workflow in VK workspace

- create workspace
- bind GC
- create worker session
- create reviewer lane / review-capable kickoff

### Future modes

- plan-first / idea-to-plan workflow
- adopt existing workspace and attach GC later
- more advanced formula-driven automation presets

---

## Dashboard mental model

The dashboard should feel like:

- **Workspace** = where code lives
- **Crew** = who is working
- **Work** = what is being done
- **Inbox** = what needs attention

### Likely main views

- Work
- Crew
- Workspace
- Inbox / Review

This should feel like an engineering operations dashboard, not just a chat tool.

---

## Workspace lifecycle

### Create new workspace from branch without starting a coding session

We likely need to extend VK to support a workflow similar to its existing **Create Workspace from PR** path, but for:

- a branch
- without immediately starting a coding session

This enables:

- VK to create the workspace first
- GC to bind later and drive automation

### Adopt existing VK workspace in GC bridge

The GC bridge needs a mode where it can bind to a preexisting VK workspace instead of always calling `/api/workspaces/start`.

That adoption flow should support:

- loading the workspace path / `container_ref`
- associating GC session state with the workspace
- creating or reusing VK sessions inside it
- using task worktrees within that workspace

---

## Worktree model

### VK workspace is top-level

Assume one VK workspace contains the primary repo checkout and environment.

### GC creates task-level worktrees inside the workspace

GC should be free to create isolated Git worktrees for tasks when beneficial.

This supports:

- safer implementation isolation
- parallel task execution
- reviewer/worker separation
- cleaner automation and handoff

### VK session working directory should point to the assigned task worktree

For GC-managed sessions:

- GC decides which worktree is assigned
- VK session is started or followed up with the appropriate `working_dir`

Prompt text can still mention the assigned directory, but the system should not rely on prompt text alone when `working_dir` is available.

---

## Session naming model

Human-friendly session labels should be the primary visible naming convention.

### Display labels

Examples:

- `Worker • Auth Refactor`
- `Reviewer • Auth Refactor`
- `Planner • Notifications`
- `Refinery • Billing Cleanup`

### Internal metadata

Keep structured identifiers separately, for example:

- GC city name
- rig name
- task/bead ID
- role type
- workflow step
- VK workspace ID
- VK session ID

This gives us both readable UX and operational traceability.

---

## Container/runtime changes

### Install GC directly in `vibe-kanban-vscode-web/Dockerfile`

The VD container should include:

- `gascity`
- likely `bd` as well if we expect GC's richer work-tracking behavior
- any required GC dependencies

### Add supervised GC process

Because we are assuming GC automation mode, the VD container should likely run a long-lived GC program under supervisor.

The exact process model still needs to be finalized, but the intent is:

- GC controller is part of the running environment
- not just a one-off CLI invoked by user actions

### Remove GC-specific Docker-in-Docker assumptions

The GC effort should not depend on:

- Docker CLI for nested stack orchestration
- Docker Compose-based GC runtime tests inside the VD container

The old harness can remain as a historical artifact briefly, but it should be retired or replaced for real implementation validation.

---

## Implementation sequence

### Phase 1: architecture and runtime base

1. extend VK API for branch-based workspace creation without auto-starting a session
2. install Gas City directly in the VD container
3. define supervised GC control-plane process in the VD container
4. add GC bridge adopt-existing-workspace mode

### Phase 2: session binding semantics

5. support GC-driven VK session startup using `working_dir`
6. rename GC-managed VK sessions to human-friendly labels
7. bind GC session metadata/state to VK workspace/session identities

### Phase 3: user-facing workflow kickoff

8. implement VD workspace creation modes:
   - plain VK
   - GC worker
   - GC worker + reviewer
9. wire actual worker/reviewer kickoff behavior on top of VK workspaces
10. add operator UI for work / crew / inbox / workspace views

### Phase 4: verification strategy

11. replace the old GC DinD harness with direct-container or host-run verification paths
12. add lighter smoke checks for GC/VK binding and workflow kickoff

---

## Open questions

### 1. Exact supervised GC process model

We still need to define exactly what GC process should run under supervisor and how it binds to workspace/city instances.

### 2. Scope of GC city per workspace

We likely want a GC city per VK workspace, but the exact shape of that mapping should be documented explicitly.

### 3. Task worktree path conventions

We need to choose stable conventions for where GC-created task worktrees live inside the VK workspace.

### 4. Verification path without Docker-in-Docker

We need a concrete replacement for the old compose-heavy harness.

---

## Current recommendation

The system should move toward this model:

- **VK creates the workspace**
- **GC runs as a supervised orchestrator inside the environment**
- **GC creates and manages task worktrees**
- **VK sessions execute inside those worktrees via `working_dir`**
- **VD presents a simplified workspace + workflow dashboard to the user**

That is the cleanest path for a VK-centric, GC-automated development experience.
