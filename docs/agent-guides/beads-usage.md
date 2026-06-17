# Beads Usage for Agents

Agents must use `bd` to track task state while working in this repository.

## Create beads with branch and session metadata

The Beads database is shared by the main checkout and all git worktrees. Because
of that, a bead does not automatically show which worktree or branch created it.

In the Docker image, `bd` and `beads` are wrapped through supervisor `PATH` so
normal create commands automatically stamp the current branch, workspace ID, and session ID:

```bash
bd create "Describe the task" --type task --priority 1
```

The wrapper adds metadata equivalent to:

```bash
/usr/local/bin/bd create "Describe the task" --metadata "{\"branch\":\"$(git branch --show-current)\",\"VK_WORKSPACE_ID\":\"$VK_WORKSPACE_ID\",\"VK_SESSION_ID\":\"$VK_SESSION_ID\"}"
```

All non-`create` commands pass through unchanged to the real Beads CLI in
`/usr/local/bin`:

```bash
bd update vkvw-123 --status in_progress
bd close vkvw-123 --reason "Implemented and validated"
```

This metadata lets humans and tools correlate a bead with the branch, workspace,
and agent session where the work started, even though all worktrees write to the
same Beads database.

## Continue naming beads explicitly

When referencing bead tasks in notes, commits, summaries, or comments, include
both the bead ID and its title, for example:

```text
vkvw-123 — Add branch metadata convention
```
