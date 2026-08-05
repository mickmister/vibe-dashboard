# External Linear Kanban smoke setup

The Linear Kanban provider is read-only in v1. It loads Linear issues from the
server and renders them through the shared external Kanban view; it does not
write status changes back to Linear.

## Linear API key auth

For local smoke testing, configure a Linear personal API key on the server:

```bash
LINEAR_KANBAN_API_KEY=<linear-personal-api-key>
```

Optional API URL override, primarily for tests/proxies:

```bash
LINEAR_KANBAN_API_URL=https://api.linear.app/graphql
```

Linear personal API keys are sent as the raw `Authorization` header value from
server-side code only. Do not prefix personal API keys with `Bearer`; Linear
OAuth access tokens use `Bearer`, but OAuth/connect UI is intentionally deferred.

Restart the VD server after changing env vars, then open a Linear URL through
the canonical launch contract:

```text
/dashboard?external_view_url=<url-encoded Linear URL>
```

Supported v1 URL shapes include Linear issue URLs, team URLs, and project URLs
without custom `/view`, `/views`, or `/cycle` path segments. The only supported
query filter in v1 is `status`, because VD maps it to Linear workflow-state
filtering. Other Linear URL query filters, custom Linear view URLs, cycle URLs,
project-view URLs, and bare workspace URLs are intentionally rejected until VD
can faithfully apply those exact Linear filters instead of loading too broad an
issue set. Storybook stories remain static and do not read Linear credentials or
fetch live Linear data.

## Secret safety

`LINEAR_KANBAN_API_KEY` and `LINEAR_KANBAN_API_URL` are read in node-only server
modules. The key is not returned in API responses, client bundles, Storybook, or
provider diagnostics. For Doppler-backed local secrets, see
`packages/integrations-env/README.md`.
