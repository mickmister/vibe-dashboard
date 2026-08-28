# External Jira Kanban OpenTelemetry

VD has a small OpenTelemetry foundation for profiling external Jira Kanban loading. It is disabled by default and only exports safe, bounded attributes. Do not add tokens, API keys, auth headers, raw `external_view_url`, raw JQL, email addresses, cookies, or Jira filter query strings to spans.

## Enable local tracing

Console exporter, useful for a quick local profile:

```bash
VD_OTEL_ENABLED=true \
VD_OTEL_TRACES_EXPORTER=console \
npm run dev
```

OTLP HTTP exporter, useful with a local OpenTelemetry Collector or a trace backend:

```bash
VD_OTEL_ENABLED=true \
OTEL_SERVICE_NAME=vibe-dashboard \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces \
npm run dev
```

`VD_OTEL_ENABLED=true` enables the SDK. Setting `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` also enables it. Use `VD_OTEL_TRACES_EXPORTER=console` for console spans; otherwise VD uses the OTLP HTTP trace exporter.

## External Jira spans

The external Kanban path emits focused spans around:

- `external_jira.board_route` — server board API route latency.
- `external_jira.parse_external_view_url` — canonical URL contract parsing.
- `external_jira.resolve_auth` — OAuth vs bot auth resolution. Only `jira.auth_source` is recorded.
- `external_jira.adapter_fetch_board` — Jira adapter latency and returned page/issue counts.
- `external_jira.resolve_request_context` and `external_jira.fetch_accessible_resources` — Jira Cloud resource resolution for OAuth.
- `external_jira.fetch_board_configuration` — Jira Agile board configuration fetch.
- `external_jira.fetch_board_issue_pages` / `external_jira.fetch_project_issue_pages` — Jira pagination work.
- `external_jira.http` — sanitized Jira HTTP child spans with endpoint family and status code, never full URL or auth headers.
- `external_jira.decorate_workspaces` — explicit VD workspace mapping decoration.
- `external_jira.decorate_beads` — explicit Beads task decoration.
- `external_jira.workspace_metrics_route` — async workspace metrics endpoint latency.
- `external_jira.workspace_metrics.summaries` and `external_jira.workspace_metrics.sessions` — VK summary/session lookups with per-source timeout isolation.
- `external_jira.client_load_board` and `external_jira.client_load_workspace_metrics` — client-side load spans when a browser tracer provider is present.

Useful safe attributes include `jira.auth_source`, `jira.view_kind`, `jira.issue_count`, `jira.page_count`, `jira.endpoint_family`, `vd.workspace_count`, and `vd.duration_ms`.

## Current profile findings

The current external Kanban performance risks identified while adding this instrumentation are:

1. Workspace metrics must stay asynchronous. The primary board API no longer waits on VK workspace summary/session calls (`vkvw-yugp`).
2. Active and archived VK workspace summaries need independent timeout/failure isolation. This is already implemented so an archived summaries hang does not drop active file/line metrics.
3. Workspace metrics still use per-workspace session calls. This can become an N+1 bottleneck as mapped workspace counts grow. Track the existing follow-up `vkvw-kdlj — Add VK bulk workspace activity summary API for external Kanban` for a cross-workspace-friendly metrics API, including agent message counts.
4. Jira API pagination remains the likely dominant latency for large boards; inspect `external_jira.http` and `external_jira.fetch_*_issue_pages` spans for page counts and slow endpoint families.

## Spot-checking a board load

1. Start VD with one of the env configurations above.
2. Open a URL like `/dashboard?external_view_url=<encoded Jira board URL>`.
3. Inspect spans in the console or trace backend.
4. Compare `external_jira.board_route` duration to `external_jira.adapter_fetch_board`, `external_jira.decorate_beads`, and `external_jira.workspace_metrics_route` to separate Jira latency from local decoration latency.
