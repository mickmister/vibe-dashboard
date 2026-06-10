# Beads Usage for Agents

Agents must use `bd` to track task state while working in this repository.

## Create beads through the branch-stamping wrapper

The Beads database is shared by the main checkout and all git worktrees. Because
of that, a bead does not automatically show which worktree or branch created it.
Agents should create beads with the repository wrapper instead of calling
`bd create` directly:

```bash
scripts/bd-agent create "Describe the task" --type task --priority 1
```

For `create`, the wrapper automatically adds branch metadata equivalent to:

```bash
bd create "Describe the task" --metadata "{\"branch\":\"$(git branch --show-current)\"}"
```

All non-`create` commands pass through unchanged, so normal `bd` commands still
work through the wrapper:

```bash
scripts/bd-agent update vkvw-123 --status in_progress
scripts/bd-agent close vkvw-123 --reason "Implemented and validated"
```

This metadata lets humans and tools correlate a bead with the branch where the
work started, even though all worktrees write to the same Beads database.

## Continue naming beads explicitly

When referencing bead tasks in notes, commits, summaries, or comments, include
both the bead ID and its title, for example:

```text
vkvw-123 — Add branch metadata convention
```
