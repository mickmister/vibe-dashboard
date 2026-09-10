# `/` and `/dashboard` — dashboard home / Voyage workspace shell

## Current role

Canonical app home. It restores or resolves a saved Voyage dashboard session, applies craft/view query parameters, and renders the full `WorkspaceShell`. It also diverts dashboard query links with external kanban view parameters into the external kanban route.

## UX issues

- **The root route is doing too many invisible jobs.** It is canonical home, saved-session restore, query-param router, external kanban host, and workspace shell. Users can land here from bookmarks, PWA install, external links, or copied deep links and see very different outcomes.
- **Voyage/craft query state is powerful but opaque.** There is no visible explanation of which saved session, craft entry, tab group, or view selection was restored from the URL.
- **Failure modes are under-surfaced.** If a saved session, craft selection, or view id cannot be resolved, the page appears to fall back silently instead of telling the user that the shared link was partially restored.
- **External kanban route piggybacks on `/dashboard`.** A query-parameter mode makes external tracker views feel less durable and harder to reason about than named routes.
- **Navigation hierarchy is unclear.** New workflow pages are standalone dashboards, while root/dashboard is a multi-pane shell. The jump between shell and standalone pages may feel like leaving the product.

## Potential improvements

- Add a small **restoration banner** for deep links: “Opened Home → Review pair from shared link” with a dismissible explanation and “copy clean link”.
- Create a named route for external tracker dashboard views, even if `/dashboard?...` remains compatible.
- Add a **link health state** when query params cannot fully resolve: show what was found, what was missing, and the fallback selected.
- Introduce a global dashboard nav model that exposes Workflows, Teams, Forms, and Admin as first-class destinations from the shell.
- Consider a “Start / Monitor / Library / Settings” top-level IA so standalone workflow pages feel connected to the home shell.
