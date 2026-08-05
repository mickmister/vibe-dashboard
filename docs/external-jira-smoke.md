# External Jira board smoke evidence

## Automated CI-safe smoke

The automated smoke test is `src/modules/plugins/kanban/jira/server/jiraVerticalSliceSmoke.test.ts`.
It uses no Atlassian credentials or external network calls.

Tested launch URL shape:

```text
https://vd.example.test/dashboard?external_view_url=https%3A%2F%2Fteam.atlassian.net%2Fjira%2Fsoftware%2Fprojects%2FVD%2Fboards%2F42%3FselectedIssue%3DVD-1
```

Covered path:

1. Extension-style VD launch URL uses canonical `external_view_url`.
2. VD parses the Jira Cloud board URL as provider `jira`, project `VD`, board `42`, site `team.atlassian.net`.
3. The board API resolves Jira credentials from a linked Atlassian OAuth token or server-side Jira bot token fallback.
4. A mocked Jira adapter returns columns, cards, and best-effort partial swimlanes.
5. VD decorates card `VD-1` from explicit VK workspace DB mapping.
6. VD decorates card `VD-1` from explicit Beads `metadata.external_issues` read via mocked `bd export`.
7. The read-only Jira board renderer shows columns, cards, partial swimlane lane, fallback `Other issues`, linked workspace, and linked bead.

## Server-side Jira bot token fallback

Before login/connect UI is available, the external Jira board API can fall back to server-side Jira Cloud API-token credentials when no linked Atlassian OAuth token is available:

```bash
JIRA_SITE_HOSTNAME=<site>.atlassian.net
JIRA_EMAIL=<bot-or-service-account-email>
JIRA_API_TOKEN=<atlassian-api-token>
```

This bot-token mode uses Atlassian's Jira Cloud Basic auth pattern (`email:apiToken`) against the direct Jira site Agile REST API, for example `https://<site>.atlassian.net/rest/agile/1.0/board/<id>/issue`. It is separate from the linked OAuth path, which uses Bearer tokens and `https://api.atlassian.com/ex/jira/{cloudId}`.

Resolution order:

1. If a signed-in user has a valid linked Atlassian OAuth access token, use it.
2. Otherwise, if all three bot env vars are present and the pasted board hostname matches `JIRA_SITE_HOSTNAME`, use the server-side bot credentials.
3. Otherwise, return an actionable auth/setup error.

Secrets are read only in server route/adapter code and must not be placed in Storybook or browser-visible env vars.

## Optional manual real-Jira smoke

Prerequisites:

- Either a user is signed in with a linked Atlassian/Jira OAuth account, or the server-side Jira bot token fallback env vars above are configured.
- Browser extension build with Jira launch support installed.
- A Jira Cloud board URL such as:

```text
https://<site>.atlassian.net/jira/software/projects/<PROJECT>/boards/<BOARD_ID>
https://<site>.atlassian.net/jira/core/projects/<PROJECT>/board?groupBy=none
```

Manual checks:

1. Open the Jira board page and click the Vibe button from the extension.
2. Confirm VD opens `/dashboard?external_view_url=<encoded Jira board URL>`.
3. Confirm VD renders a read-only board with Jira columns and cards.
4. Confirm swimlanes render when available, or the UI shows the best-effort fallback/fidelity state.
5. If explicit mappings exist, confirm related VK workspaces and Beads appear on matching cards.

Known limitations for v1:

- Jira data is fetched live on page load; issue snapshots are not persisted.
- Drag/drop or writeback to Jira is intentionally not implemented.
- Jira Core/Work Management project board URLs do not include an Agile board id; VD uses enhanced Jira search with project-scoped JQL only and infers columns from returned issue statuses for those URLs. Jira UI `filter=` query fragments are intentionally ignored for now to prevent URL-provided JQL from widening server-side bot-token access.
- Swimlane fidelity is best-effort and may be `full`, `partial`, `none`, or `unknown` depending on available Jira data.
- Bead and workspace correlations are explicit only; there is no heuristic auto-linking.

For Doppler-backed local Jira/Linear secrets, see `packages/integrations-env/README.md`.
