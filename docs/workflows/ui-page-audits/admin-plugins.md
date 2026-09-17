# `/dashboard/admin/plugins` — plugin admin

## Current role

Admin table for plugin runtime status, desired enabled state, observed state, install path, error, and enable/disable actions.

## UX issues

- **Table is implementation-first.** Plugin id, observed state, install path, and desired state are useful for operators but not enough for a user deciding whether a plugin is safe or useful.
- **No grouping by health or source.** Healthy, disabled, errored, first-party, and local plugins appear in one flat list.
- **Actions are low-context.** “Enable”/“Disable” does not explain consequences, restart requirements, permissions, or routes that will appear/disappear.
- **Errors are cramped in a table cell.** Long operational errors are likely truncated or hard to act on.
- **No audit trail.** Admin changes need “who changed what and when” if this becomes a team product surface.

## Potential improvements

- Group plugins into “Needs attention”, “Enabled”, “Available”, and “Disabled”.
- Replace raw observed state with plain-language health: “Running”, “Disabled by admin”, “Install failed”, “Needs restart”.
- Add plugin detail drawer with description, routes, required env vars, permissions, logs, and remediation steps.
- Add confirmation for disabling plugins with active surfaces.
- Add search/filter and a compact “copy diagnostics” action for support.
