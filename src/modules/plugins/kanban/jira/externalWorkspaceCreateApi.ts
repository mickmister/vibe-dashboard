import type { ExternalKanbanCardDto } from './externalTrackerBoardApi';
import type { ExternalIssueProvider } from '../contracts';

export type VkExecutor =
  | 'CLAUDE_CODE'
  | 'CODEX'
  | 'GEMINI'
  | 'AMP'
  | 'CURSOR_AGENT'
  | 'COPILOT'
  | 'DROID'
  | 'OPENCODE'
  | 'QWEN_CODE';

export interface VkExecutorConfigDto {
  executor: VkExecutor;
  variant?: string | null;
  model_id?: string | null;
  agent_id?: string | null;
  reasoning_id?: string | null;
  permission_policy?: string | null;
}

export interface ExternalWorkspaceCandidateRepoDto {
  name: string;
  path: string;
  registeredRepoId?: string;
  defaultTargetBranch?: string | null;
}

export interface ExternalWorkspaceCreateOptionsDto {
  reposRoot: string;
  repos: ExternalWorkspaceCandidateRepoDto[];
  defaultExecutorConfig: VkExecutorConfigDto;
  executors: VkExecutor[];
}

export interface VkRepoDto {
  id: string;
  path: string;
  name: string;
  display_name: string;
  default_target_branch?: string | null;
}

export interface VkBranchDto {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  last_commit_date: string | null;
}

export interface VkWorkspaceDto {
  id: string;
  name: string | null;
  branch: string;
  container_ref: string | null;
}

export interface BulkJiraWorkspaceConversionWorkspaceDto {
  workspaceId: string;
  displayName: string;
  branch: string;
  workspaceDir?: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  repos: Array<{ id: string; name: string; displayName: string; targetBranch: string }>;
  hasLinkedJiraIssue: boolean;
  linkedJiraIssues: Array<{
    provider: ExternalIssueProvider;
    key: string;
    id?: string;
    url: string;
    site?: string;
    isPrimary: boolean;
    metadata?: Record<string, unknown>;
  }>;
}

export interface BulkJiraRepoProjectMappingDto {
  repoId: string;
  repoName?: string;
  provider: 'jira';
  siteHostname: string;
  projectKey: string;
  issueTypeName?: string;
  updatedAt?: string;
}

export interface BulkJiraWorkspaceConversionOptionsDto {
  workspaces: BulkJiraWorkspaceConversionWorkspaceDto[];
  repoProjectMappings: BulkJiraRepoProjectMappingDto[];
}

export interface CreatedJiraIssueDto {
  id: string;
  key: string;
  url: string;
  self?: string;
}

export type BulkJiraWorkspaceConversionResultDto =
  | { workspaceId: string; status: 'created'; issue: CreatedJiraIssueDto }
  | { workspaceId: string; status: 'created_mapping_failed'; issue: CreatedJiraIssueDto; error: ExternalWorkspaceApiError }
  | { workspaceId: string; status: 'skipped'; linkedJiraIssues: BulkJiraWorkspaceConversionWorkspaceDto['linkedJiraIssues'] }
  | { workspaceId: string; status: 'failed'; error: ExternalWorkspaceApiError };

export interface VkWorkspaceCreateSuccessDto {
  workspace: VkWorkspaceDto;
  executionProcess: { id: string; session_id: string; status: string };
}

export type ExternalWorkspaceApiError = { code: string; message: string; userAction: string };


export interface ExternalWorkspaceMetricsDto {
  filesChanged?: number;
  linesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  agentSessions?: number;
  agentMessages?: number;
}

export async function fetchExternalWorkspaceMetrics(workspaceIds: string[], fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ metricsByWorkspaceId: Record<string, ExternalWorkspaceMetricsDto> }>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/vk/workspace-metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ workspaceIds }),
  }));
}

export async function fetchBulkJiraWorkspaceConversionOptions(fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ options: BulkJiraWorkspaceConversionOptionsDto }>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/vk/workspace-jira-conversion-options', { headers: { accept: 'application/json' } }));
}

type ApiEnvelope<T> = { ok: true } & T | { ok: false; error: ExternalWorkspaceApiError };

export async function fetchExternalWorkspaceCreateOptions(fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ options: ExternalWorkspaceCreateOptionsDto }>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/vk/workspace-create-options', { headers: { accept: 'application/json' } }));
}

export async function registerExternalWorkspaceRepo(path: string, fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ repo: VkRepoDto }>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/vk/repos/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ path }),
  }));
}

export async function cloneExternalWorkspaceRepo(githubUrl: string, fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ repo: VkRepoDto }>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/vk/repos/clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ githubUrl }),
  }));
}

export async function fetchExternalWorkspaceRepoBranches(repoId: string, fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ branches: VkBranchDto[] }>> {
  return readEnvelope(await fetchImpl(`/dashboard/api/external-trackers/vk/repos/${encodeURIComponent(repoId)}/branches`, { headers: { accept: 'application/json' } }));
}

export async function createExternalIssueWorkspace({
  card,
  prompt,
  repos,
  executorConfig,
  siteHostname,
}: {
  card: ExternalKanbanCardDto;
  siteHostname: string;
  prompt: string;
  repos: Array<{ repo_id: string; target_branch: string }>;
  executorConfig: VkExecutorConfigDto;
}, fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<VkWorkspaceCreateSuccessDto>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/vk/workspaces/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      externalIssue: {
        provider: 'jira',
        key: card.key,
        id: card.id,
        url: card.url,
        site: siteHostname,
      },
      workspace: {
        name: card.key,
        prompt,
        repos,
        linked_issue: null,
        executor_config: executorConfig,
        attachment_ids: [],
      },
    }),
  }));
}

export async function bulkCreateJiraTicketsFromWorkspaces({
  siteHostname,
  projectKey,
  issueTypeId,
  issueTypeName,
  workspaceIds,
  repoProjectMappingRepoId,
}: {
  siteHostname: string;
  projectKey: string;
  issueTypeId?: string;
  issueTypeName?: string;
  workspaceIds: string[];
  repoProjectMappingRepoId?: string;
}, fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ results: BulkJiraWorkspaceConversionResultDto[] }>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/jira/workspaces/bulk-create-issues', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ siteHostname, projectKey, issueTypeId, issueTypeName, workspaceIds, repoProjectMappingRepoId }),
  }));
}

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  const json = await response.json().catch(() => undefined) as ApiEnvelope<T> | undefined;
  if (json?.ok === true || json?.ok === false) return json;
  return {
    ok: false,
    error: {
      code: 'external_workspace_response_invalid',
      message: `Workspace API returned HTTP ${response.status}.`,
      userAction: 'Try again; if this persists, report the response shape.',
    },
  };
}
