# External Jira board smoke evidence

## Automated CI-safe smoke

The automated smoke test is `src/server/external-integrations/jiraVerticalSliceSmoke.test.ts`.
It uses no Atlassian credentials or external network calls.

Tested launch URL shape:

```text
https://vd.example.test/dashboard?external_view_url=https%3A%2F%2Fteam.atlassian.net%2Fjira%2Fsoftware%2Fprojects%2FVD%2Fboards%2F42%3FselectedIssue%3DVD-1
```

Covered path:

1. Extension-style VD launch URL uses canonical `external_view_url`.
2. VD parses the Jira Cloud board URL as provider `jira`, project `VD`, board `42`, site `team.atlassian.net`.
3. The gated board API requires an authenticated user with a linked Atlassian account token.
4. A mocked Jira adapter returns columns, cards, and best-effort partial swimlanes.
5. VD decorates card `VD-1` from explicit VK workspace DB mapping.
6. VD decorates card `VD-1` from explicit Beads `metadata.external_issues` read via mocked `bd export`.
7. The read-only Jira board renderer shows columns, cards, partial swimlane lane, fallback `Other issues`, linked workspace, and linked bead.

## Optional manual real-Jira smoke

Prerequisites:

- External tracker feature gate enabled.
- User is signed in to VD.
- User has connected Atlassian/Jira through the link-only account flow.
- Browser extension build with Jira launch support installed.
- A Jira Cloud board URL such as:

```text
https://<site>.atlassian.net/jira/software/projects/<PROJECT>/boards/<BOARD_ID>
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
- Swimlane fidelity is best-effort and may be `full`, `partial`, `none`, or `unknown` depending on available Jira data.
- Bead and workspace correlations are explicit only; there is no heuristic auto-linking.
