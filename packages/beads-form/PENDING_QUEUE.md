# Pending BeadsForm queue realtime/update and cache design

The pending queue uses persisted cached-first reads plus bounded, read-only scans of first-level directories under `~/repos`. Set `BEADS_FORM_PENDING_PARENT_DIR=/path/to/all-repos` on the VD server to change the default parent directory.

## Options considered

- `bd list --watch`: useful for a single repo terminal view, but it is display-oriented and not a stable multi-repo event API for an app queue.
- Filesystem watching `.beads`: low latency, but different backends/worktrees can resolve a database outside the current checkout. Watching implementation files risks backend coupling and misses cases where `bd` resolves a shared DB elsewhere.
- Direct Dolt/sqlite queries: fastest in theory, but this app should not assume internal schema/backend details or accidentally trigger migrations/locks.
- Periodic polling across all repos: simple, but can become expensive under large `~/repos` trees and creates avoidable background load.
- Explicit refresh: safe and still available. It only runs when the user opens or refreshes the queue, uses `bd --readonly`, and handles inaccessible/schema-skew repos as skipped entries.
- Disk cache: fastest cold-start UX. The server persists the last successful queue result under `${XDG_CACHE_HOME:-~/.cache}/vibe-dashboard/beads-form-pending` and serves it immediately even when stale. Staleness is a refresh hint, not an eviction policy.

## Current decision

Serve memory cache first, then disk cache, then run a fresh scan if no cache exists. If cached data is served, the client triggers a fresh read in the background and keeps cached content visible; if the fresh result differs, the UI shows an update notice. Stable/production servers warm `BEADS_FORM_PENDING_PARENT_DIR` in the background on startup without blocking startup. Vite/dev servers do not scan every repo on restart by default; set `BEADS_FORM_PENDING_WARM_ON_STARTUP=1` only when intentional.

Fresh scans only inspect first-level directories under the configured parent dir, skip hidden directories, cap the scan at 80 repos by default, and call `bd --readonly list --json --all --limit 0 --has-metadata-key ...` for `beadFormsSummary`, `beadForms`, and legacy `beadsWeb` metadata. Do not bulk `bd show` matching beads; `bd list --json` includes the metadata needed for pending queue entries. Prefer `beadFormsSummary.pendingFormIds` when present, and fall back to legacy form `responses[]` inspection when it is absent. A form is pending when the summary lists the form id in `pendingFormIds`, or for legacy summary-less beads when it has no `responses[]` entries.

This avoids corrupting or migrating bead DBs unexpectedly, does not depend on `.beads` being local to the worktree, and keeps failures isolated per repo. Follow-ups can add manual repo roots, configurable limits, polling with backoff, or a real bd-native event API if one becomes available.
