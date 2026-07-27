# External Jira Storybook fixtures

The app's live Jira board route uses Better Auth with a linked Atlassian OAuth account. Storybook should not perform live Jira auth or network fetches, so use the node-only fixture generator to snapshot a Jira board into a local generated fixture.

## Current Jira integration status

- External tracker UI/API is gated by `VD_EXTERNAL_TRACKERS_ENABLED=true`.
- App OAuth is scaffolded with Better Auth's Atlassian provider.
- App OAuth env vars are `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`.
- The live app board route reads a linked Better Auth Atlassian account token from `BetterAuthAccount`.
- Storybook stories are deterministic; generated Jira stories read a local JSON fixture when present and fall back to a setup message when absent.

## Generate a local fixture

The generator expects an Atlassian OAuth 2.0 (3LO) access token. Atlassian documents OAuth 2.0 product API calls through `https://api.atlassian.com/ex/jira/{cloudid}/...` with `Authorization: Bearer <access-token>`, after resolving the site through `accessible-resources`.

```bash
ATLASSIAN_STORYBOOK_ACCESS_TOKEN="<oauth-access-token>" \
  npm run storybook:jira-fixture -- \
  --url "https://your-site.atlassian.net/jira/software/projects/PROJ/boards/123"
```

`JIRA_STORYBOOK_ACCESS_TOKEN` is accepted as an alias. This is **not** a Jira API token/basic-auth workflow; use OAuth access-token wording for this script.

By default the output is:

```text
src/storybook-fixtures/external-jira/local.generated.json
```

Generated `*.generated.json` files in that directory are gitignored. Do not commit real customer/company Jira data unless it has been intentionally reviewed and sanitized.

The default sanitizer removes account IDs, avatar URLs, raw metadata, labels, and issue titles. It preserves board structure, columns, statuses, issue keys, and counts so the Storybook board can be spot-checked without exposing most textual issue content. For a local-only debugging snapshot with recognizable titles/resource names, add `--preserve-text`; keep that file uncommitted.

## View in Storybook

After generating the fixture, restart Storybook if it is already running so Vite picks up the new generated JSON file.

```bash
PORT=6006 npm run storybook:dev
```

Open **External Trackers/Jira Board View → Generated Local Jira Fixture**. Existing static Jira stories remain available and do not require any fixture.
