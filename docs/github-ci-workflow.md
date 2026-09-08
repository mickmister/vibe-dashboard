# GitHub CI failure workflow

This app can receive GitHub `workflow_run` webhooks and send CI failure context to the latest VK session for the matching workspace branch.

## Routes

All routes are prefixed with `/dashboard` so they pass through the dashboard proxy.

- `GET /dashboard/api/workflows/health`
- `GET /dashboard/api/workflows`
- `POST /dashboard/api/webhooks/github`
- `POST /dashboard/api/workflows/:workflowId/run`

## Required environment

### `GITHUB_WEBHOOK_SECRET`

Required for `POST /dashboard/api/webhooks/github`.

The route verifies GitHub's `X-Hub-Signature-256` header. Missing configuration returns `500`; missing, malformed, or invalid signatures return `401`.

### `VIBE_API_URL` / `VK_API_URL`

The workflow server must be able to reach the VK backend API. The server-side VK client resolves the base URL from:

1. `VIBE_API_URL`
2. `VK_API_URL`
3. `http://localhost:3007`

The client appends `/api` unless the configured URL already ends with `/api`.

Examples:

```bash
VIBE_API_URL=http://localhost:3007
VIBE_API_URL=https://vk.example.com
VIBE_API_URL=https://vk.example.com/api
```

## GitHub webhook setup

In the GitHub repository whose CI should notify VK agents:

1. Go to **Settings → Webhooks → Add webhook**.
2. Set **Payload URL** to:

   ```text
   https://<your-dashboard-host>/dashboard/api/webhooks/github
   ```

3. Set **Content type** to `application/json`.
4. Set **Secret** to the same value as `GITHUB_WEBHOOK_SECRET`.
5. Enable **Workflow runs** events.
6. Save the webhook.

## Matching behavior

For same-repo CI runs, the workflow uses the GitHub `workflow_run` payload:

- repository: `repository.full_name`
- branch: `workflow_run.head_branch`
- SHA: `workflow_run.head_sha`
- run URL: `workflow_run.html_url`

It then:

1. Lists non-archived VK workspaces.
2. Fetches each workspace's repos.
3. Finds a workspace whose repo and branch match the CI run.
4. Fetches sessions for that workspace.
5. Selects the latest session by `created_at`.
6. Sends a bounded CI-failure prompt to that session.

If no workspace matches, or the matching workspace has no sessions, the workflow skips and logs the outcome. It does not create a new session.

## Testing checklist

1. Deploy the latest app code.
2. Set `GITHUB_WEBHOOK_SECRET`.
3. Confirm health:

   ```bash
   curl https://<host>/dashboard/api/workflows/health
   ```

   Expected:

   ```json
   {"ok":true}
   ```

4. Confirm workflow registration:

   ```bash
   curl https://<host>/dashboard/api/workflows
   ```

   Expected list includes `github-ci-failure`.

5. Create/open a VK workspace for the branch that will fail CI.
6. Ensure the workspace has at least one session.
7. Trigger a failing GitHub Actions run on that branch.
8. Inspect GitHub webhook **Recent deliveries** for status and response body.

Useful webhook response outcomes:

- `ignored`
- `no_matching_workspace`
- `no_sessions`
- `message_sent`
