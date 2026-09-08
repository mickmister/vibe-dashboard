import { withOtelSpan } from '../../../../lib/otel';
import type { VibeKanbanServerClient, WorkspaceSummary } from '../../../../server/vk-client';

export async function loadRelatedWorkspaceMetrics(
  workspaceIds: string[],
  vkClient: Pick<VibeKanbanServerClient, 'getWorkspaceSummaries' | 'getSessions'>,
  timeoutMs: number,
): Promise<Map<string, Record<string, number>>> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds)].filter(Boolean);
  if (uniqueWorkspaceIds.length === 0) return new Map();

  const activeSummariesPromise = withOtelSpan('external_kanban.workspace_metrics.summaries', { 'vk.archived': false }, () => withTimeoutCall(() => vkClient.getWorkspaceSummaries(false), timeoutMs)).catch(() => undefined);
  const archivedSummariesPromise = withOtelSpan('external_kanban.workspace_metrics.summaries', { 'vk.archived': true }, () => withTimeoutCall(() => vkClient.getWorkspaceSummaries(true), timeoutMs)).catch(() => undefined);
  const sessionCountsPromise = Promise.all(uniqueWorkspaceIds.map(async (workspaceId): Promise<[string, number] | undefined> => {
    const sessions = await withOtelSpan('external_kanban.workspace_metrics.sessions', { 'vd.workspace_count': 1 }, () => withTimeoutCall(() => vkClient.getSessions(workspaceId), timeoutMs)).catch(() => undefined);
    return sessions ? [workspaceId, sessions.length] : undefined;
  }));

  const [activeSummaries, archivedSummaries, sessionEntries] = await Promise.all([activeSummariesPromise, archivedSummariesPromise, sessionCountsPromise]);
  const summariesByWorkspaceId = new Map(
    [activeSummaries, archivedSummaries]
      .flatMap((response) => response?.summaries ?? [])
      .map((summary) => [summary.workspace_id, summary] as const),
  );
  const sessionCounts = new Map(sessionEntries.filter((entry): entry is [string, number] => Boolean(entry)));

  const entries: Array<[string, Record<string, number>]> = [];
  for (const workspaceId of uniqueWorkspaceIds) {
    const metrics = vkActivityMetricsFromSummary(summariesByWorkspaceId.get(workspaceId), sessionCounts.get(workspaceId));
    if (Object.keys(metrics).length > 0) entries.push([workspaceId, metrics]);
  }
  return new Map(entries);
}

export function withTimeoutCall<T>(factory: () => Promise<T>, timeoutMs: number): Promise<T> {
  return withTimeout(Promise.resolve().then(factory), timeoutMs);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function vkActivityMetricsFromSummary(summary: WorkspaceSummary | undefined, agentSessions: number | undefined): Record<string, number> {
  const metrics: Record<string, number> = {};
  if (summary?.files_changed != null) metrics.filesChanged = summary.files_changed;
  if (summary?.lines_added != null || summary?.lines_removed != null) {
    metrics.linesChanged = (summary.lines_added ?? 0) + (summary.lines_removed ?? 0);
    if (summary.lines_added != null) metrics.linesAdded = summary.lines_added;
    if (summary.lines_removed != null) metrics.linesRemoved = summary.lines_removed;
  }
  if (agentSessions !== undefined) metrics.agentSessions = agentSessions;
  return metrics;
}
