import type { ExternalKanbanCardDto } from '../boardTypes';
import type { ExternalIssueProvider } from '../contracts';
import {
  createExternalIssueWorkspace,
  readEnvelope,
  type ApiEnvelope,
  type ExternalWorkspaceApiError,
  type VkExecutorConfigDto,
} from '../externalWorkspaceApi';

export type {
  ApiEnvelope,
  ExternalWorkspaceApiError,
  ExternalWorkspaceCandidateRepoDto,
  ExternalWorkspaceCreateOptionsDto,
  ExternalWorkspaceMetricsDto,
  VkBranchDto,
  VkExecutor,
  VkExecutorConfigDto,
  VkRepoDto,
  VkWorkspaceCreateSuccessDto,
  VkWorkspaceDto,
} from '../externalWorkspaceApi';

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

export async function createExternalJiraIssueWorkspace({
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
}, fetchImpl: typeof fetch = fetch) {
  return createExternalIssueWorkspace({
    provider: 'jira',
    card,
    prompt,
    repos,
    executorConfig,
    siteHostname,
  }, fetchImpl);
}

export async function fetchBulkJiraWorkspaceConversionOptions(fetchImpl: typeof fetch = fetch): Promise<ApiEnvelope<{ options: BulkJiraWorkspaceConversionOptionsDto }>> {
  return readEnvelope(await fetchImpl('/dashboard/api/external-trackers/vk/workspace-jira-conversion-options', { headers: { accept: 'application/json' } }));
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
