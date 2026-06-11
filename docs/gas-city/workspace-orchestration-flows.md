# Gas City + VK workspace orchestration flows

This document captures the Milestone 3 user-flow contract for adding optional Gas City (GC) orchestration to Vibe Dashboard (VD) workspace creation while keeping Vibe Kanban (VK) as the workspace and conversation UI primitive.

## Product principles

1. **VK workspaces stay the concrete work arena.** VK owns repository checkout/provisioning, container/worktree paths, executor sessions, and the existing conversation UI.
2. **GC is optional orchestration on top.** GC routes work, creates/adopts sessions, dispatches formulas, and coordinates reviewer-capable workflows. A user can still create a plain VK workspace with no GC involvement.
3. **Hide GC jargon until needed.** First-pass labels should read like workflow modes ("Start workspace", "Worker workflow", "Worker + review") instead of exposing `gc sling`, formulas, rigs, or mayor roles as primary UI terms.
4. **VD owns integration state.** VD/Springboard stores user choices and generated GC runtime config. The flow must not mutate the source-controlled `gascity` repo.
5. **Every GC-backed flow has a VK-first recovery path.** If GC setup or adoption fails after VK workspace creation, the user should still be able to open the VK workspace/session and continue manually.

## Modes in the new workspace form

The new workspace form should start from the existing VK fields, then add a compact **Workflow** selector.

| Mode | User-facing label | What VD does | What GC does | Primary result |
| --- | --- | --- | --- | --- |
| `plain_vk` | Start workspace | Calls VK `/workspaces/start` with the selected repo, branch, executor, and prompt. | Nothing. | Normal VK workspace + initial VK session. |
| `gc_worker` | Worker workflow | Creates a VK workspace and initial VK session, opens it in VD, then asks GC to adopt the VK session/workspace as a managed lane. | Creates/adopts one GC session for the worker template/role and records VK workspace/session metadata. | One VK workspace visible in existing VD/VK UI, plus one GC-managed worker lane. |
| `gc_worker_review` | Worker + review | Same as `gc_worker`, then starts a reviewer-capable kickoff. | Creates/adopts worker lane and creates or routes review work to a reviewer role/session/formula. | One VK workspace with worker and review orchestration available from GC. |

### Default field set

Always visible:

- Workspace name
- Repository/repositories
- Target branch
- Prompt/task description
- VK executor
- Workflow mode

GC-backed modes reveal an advanced section:

- GC template/role for worker (default: `worker`)
- Optional worker alias/title
- Reviewer role/template (only `gc_worker_review`, default: `reviewer`)
- Optional formula/workflow preset (examples: implementation, review, worker+review)
- Generated city/runtime selection if no runtime is configured

## Sequence: plain VK workspace

1. User selects `Start workspace`.
2. VD calls `vkClient.createAndStartWorkspace`.
3. VD refreshes workspace branch/container status.
4. VD opens the VK workspace tab group using the returned `container_ref`.
5. No GC state is created.

## Sequence: GC-managed worker workflow

1. User selects `Worker workflow`.
2. VD calls VK `/workspaces/start` with the prompt so VK creates the workspace and initial session.
3. VD refreshes the VK workspace until `container_ref` is available.
4. VD opens the workspace in the existing VK UI.
5. VD calls the Gas City module action to adopt the VK workspace/session:
   - `workspaceId`
   - `workspaceName`
   - `sessionId` from VK execution process
   - `executor`
   - `workingDir`/repo hint
   - selected GC template/alias/title
6. GC bridge starts/adopts the session with `VIBE_ADOPT_WORKSPACE_ID`, `VIBE_ADOPT_SESSION_ID`, `VIBE_SESSION_LABEL`, and related metadata.
7. The Gas City panel can refresh sessions and show the adopted lane.

## Sequence: GC worker + reviewer workflow

1. Run the `gc_worker` sequence.
2. VD sends a follow-up GC kickoff action that uses the adopted worker lane plus reviewer settings.
3. GC either:
   - creates a reviewer session from the reviewer template, or
   - dispatches a configured formula/order that routes implementation and review work.
4. VD opens the VK workspace and leaves the user in the conversation UI, with GC status available in the Gas City tab.
5. If reviewer kickoff fails, VD keeps the workspace open and reports a recoverable GC error with a retry action.

## Boundary contract

| Concern | Owner | Notes |
| --- | --- | --- |
| Repository selection and branch checkout | VK | VD uses existing VK APIs. |
| Workspace container path and tab opening | VK + VD | VK returns `container_ref`; VD opens it in current workspace UI. |
| User-facing conversations | VK UI | GC-managed sessions should still surface through VK sessions where possible. |
| Orchestration graph, formulas, sling routing | GC | VD asks GC to adopt/dispatch; agents do not directly call VK APIs unless acting through the bridge. |
| Generated GC config and local pack refs | VD/Springboard | Runtime TOML is generated from VD-owned state. |
| Smaller task worktrees inside a VK workspace | GC-selected workflow using VK primitive | GC can instruct a VK-backed session to work in a provisioned worktree path; VK remains the UI surface. |

## Error handling requirements

- If VK workspace creation fails: no GC calls should run.
- If VK workspace is created but `container_ref` is delayed: show workspace-created progress and retry refresh.
- If GC adoption fails: keep/open the VK workspace and expose retry details in the Gas City panel.
- If reviewer kickoff fails: keep worker lane and workspace intact; allow retry of only reviewer kickoff.
- Record enough IDs in Springboard/GC state to correlate: VK workspace ID, VK session ID, GC session ID/title, selected mode, repo/branch.

## Implementation slices

1. Extend the New Workspace/Add Tab path with a workflow selector and mode-specific advanced fields.
2. Extract the existing Gas City panel bootstrap logic into reusable actions/helpers so it can be called by the New Workspace flow.
3. Add a GC action for reviewer-capable kickoff after adoption.
4. Add tests for payload construction and failure boundaries:
   - plain VK mode does not call GC
   - GC worker mode adopts exactly one VK session
   - worker+review mode can retry reviewer kickoff without recreating the VK workspace
