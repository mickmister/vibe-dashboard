# Beads Usage for Agents

Agents must use `bd` to track task state while working in this repository.

## Record the active branch on beads

The Beads database is shared by the main checkout and all git worktrees. Because
of that, a bead does not automatically show which worktree or branch last touched
it. When an agent creates, claims, updates, or closes a bead, stamp the bead with
the current git branch using metadata:

```bash
bd update <bead-id> --set-metadata branch="$(git branch --show-current)"
```

Use the relevant bead ID in place of `<bead-id>`.

Examples:

```bash
bd update vkvw-123 --status in_progress \
  --set-metadata branch="$(git branch --show-current)"

bd close vkvw-123 --reason "Implemented and validated" && \
  bd update vkvw-123 --set-metadata branch="$(git branch --show-current)"
```

This metadata lets humans and tools correlate a bead with the branch where the
work is happening, even though all worktrees write to the same Beads database.

## Continue naming beads explicitly

When referencing bead tasks in notes, commits, summaries, or comments, include
both the bead ID and its title, for example:

```text
vkvw-123 — Add branch metadata convention
```
