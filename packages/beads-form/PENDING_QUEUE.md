# Pending BeadsForm queue realtime/update research

The MVP queue uses explicit refresh plus bounded, read-only scans of first-level directories under `~/repos`.

## Options considered

- `bd list --watch`: useful for a single repo terminal view, but it is display-oriented and not a stable multi-repo event API for an app queue.
- Filesystem watching `.beads`: low latency, but different backends/worktrees can resolve a database outside the current checkout. Watching implementation files risks backend coupling and misses cases where `bd` resolves a shared DB elsewhere.
- Direct Dolt/sqlite queries: fastest in theory, but this app should not assume internal schema/backend details or accidentally trigger migrations/locks.
- Periodic polling across all repos: simple, but can become expensive under large `~/repos` trees and creates avoidable background load.
- Explicit refresh: safest first slice. It only runs when the user opens or refreshes the queue, uses `bd --readonly`, and handles inaccessible/schema-skew repos as skipped entries.

## MVP decision

Use explicit refresh. Scan only first-level directories under `~/repos`, skip hidden directories, cap the scan at 80 repos by default, call `bd --readonly list --has-metadata-key beadForms/beadsWeb`, then `bd --readonly show --json --long` for matching beads. A form is pending when it has no `responses[]` entries.

This avoids corrupting or migrating bead DBs unexpectedly, does not depend on `.beads` being local to the worktree, and keeps failures isolated per repo. Follow-ups can add manual repo roots, configurable limits, polling with backoff, or a real bd-native event API if one becomes available.
