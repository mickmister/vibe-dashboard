import type {
  MattermostIntegrationConfig,
  VkBridgeClient,
  VkExecutionProcess,
  VkExecutionStatus,
  VkFollowUpRequest,
  VkRemoteIssue,
  VkSession,
  VkWorkspace,
  VkWorkspaceRepo,
  VkWorkspaceSummary,
} from './types';

type FetchLike = typeof fetch;

export type VkQueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface VkFetchClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchLike;
}

interface VkApiEnvelope<T, E = unknown> {
  success: boolean;
  data: T;
  message?: string;
  error_data?: E;
}

interface VkMutationResponse<T> {
  data: T;
  txid: number;
}

interface VkRemoteIssueApi {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
}

interface VkWorkspaceApi {
  id: string;
  task_id: string | null;
  container_ref: string | null;
  name: string | null;
  archived: boolean;
  pinned: boolean;
}

interface VkWorkspaceSummaryApi {
  workspace_id: string;
  latest_session_id: string | null;
  has_pending_approval: boolean;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  latest_process_status: VkExecutionStatus;
  latest_process_completed_at?: string | null;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  pr_status: 'open' | 'merged' | 'closed' | 'unknown' | null;
  pr_number?: number | string | null;
  pr_url?: string | null;
}

interface VkWorkspaceSummaryResponseApi {
  summaries: VkWorkspaceSummaryApi[];
}

interface VkSessionApi {
  id: string;
  workspace_id: string;
  name: string | null;
}

interface VkWorkspaceRepoApi {
  id: string;
  name: string;
  display_name?: string | null;
  target_branch?: string | null;
}

interface VkExecutionProcessApi {
  id: string;
  session_id: string;
  status: VkExecutionStatus;
  created_at?: string;
  updated_at?: string;
}

interface VkStartWorkspaceResponseApi {
  workspace: VkWorkspaceApi;
  execution_process: VkExecutionProcessApi;
}

interface VkQueueStatusApi {
  status: 'empty' | 'queued';
  message?: unknown;
}

const DEFAULT_ISSUE_SORT_ORDER = 0;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function toBearerToken(apiKey: string): string {
  return /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`;
}

function applyQueryParams(url: URL, query?: VkQueryParams): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapWorkspace(workspace: VkWorkspaceApi): VkWorkspace {
  return {
    id: workspace.id,
    taskId: workspace.task_id ?? '',
    containerRef: workspace.container_ref,
    name: workspace.name,
    archived: workspace.archived,
    pinned: workspace.pinned,
  };
}

function mapWorkspaceSummary(summary: VkWorkspaceSummaryApi): VkWorkspaceSummary {
  return {
    workspaceId: summary.workspace_id,
    latestSessionId: summary.latest_session_id,
    hasPendingApproval: summary.has_pending_approval,
    hasRunningDevServer: summary.has_running_dev_server,
    hasUnseenTurns: summary.has_unseen_turns,
    latestProcessStatus: summary.latest_process_status,
    latestProcessCompletedAt: summary.latest_process_completed_at ?? undefined,
    filesChanged: summary.files_changed,
    linesAdded: summary.lines_added,
    linesRemoved: summary.lines_removed,
    prStatus: summary.pr_status,
    prNumber:
      summary.pr_number === undefined || summary.pr_number === null
        ? null
        : String(summary.pr_number),
    prUrl: summary.pr_url ?? null,
  };
}

function mapSession(session: VkSessionApi): VkSession {
  return {
    id: session.id,
    workspaceId: session.workspace_id,
    name: session.name,
  };
}

function mapWorkspaceRepo(repo: VkWorkspaceRepoApi): VkWorkspaceRepo {
  return {
    id: repo.id,
    name: repo.name,
    displayName: repo.display_name ?? null,
    targetBranch: repo.target_branch ?? null,
  };
}

function mapExecutionProcess(
  executionProcess: VkExecutionProcessApi
): VkExecutionProcess {
  return {
    id: executionProcess.id,
    sessionId: executionProcess.session_id,
    status: executionProcess.status,
    createdAt: executionProcess.created_at,
    updatedAt: executionProcess.updated_at,
  };
}

function mapRemoteIssue(issue: VkRemoteIssueApi): VkRemoteIssue {
  return {
    id: issue.id,
    projectId: issue.project_id,
    title: issue.title,
    description: issue.description,
  };
}

function buildDefaultHeaders(apiKey?: string): Headers {
  const headers = new Headers({
    Accept: 'application/json',
  });

  if (apiKey) {
    const bearerToken = toBearerToken(apiKey);
    headers.set('Authorization', bearerToken);
    headers.set('Authorisation', bearerToken);
  }

  return headers;
}

function getErrorMessage(
  method: string,
  url: string,
  fallbackStatus: string,
  payload?: Partial<VkApiEnvelope<unknown>>
): string {
  const payloadMessage =
    typeof payload?.message === 'string' && payload.message.trim()
      ? payload.message
      : null;

  return payloadMessage ?? `${method} ${url} failed: ${fallbackStatus}`;
}

export function buildVkApiUrl(
  baseUrl: string,
  path: string,
  query?: VkQueryParams
): string {
  const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`);
  applyQueryParams(url, query);
  return url.toString();
}

export function buildVkWebSocketUrl(
  baseUrl: string,
  path: string,
  query?: VkQueryParams
): string {
  const url = new URL(buildVkApiUrl(baseUrl, path, query));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export class VkFetchClient implements VkBridgeClient {
  private readonly baseUrl: string;

  private readonly apiKey?: string;

  private readonly fetchImpl: FetchLike;

  constructor(options: VkFetchClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: VkQueryParams;
    } = {}
  ): Promise<T> {
    const url = buildVkApiUrl(this.baseUrl, path, options.query);
    const headers = buildDefaultHeaders(this.apiKey);
    const init: RequestInit = {
      method,
      headers,
    };

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url, init);

    if (response.status === 204) {
      return undefined as T;
    }

    let payload: VkApiEnvelope<T> | undefined;
    try {
      payload = (await response.json()) as VkApiEnvelope<T>;
    } catch {
      if (!response.ok) {
        throw new Error(getErrorMessage(method, url, response.statusText));
      }
      throw new Error(`Invalid JSON response from ${method} ${url}`);
    }

    if (!response.ok) {
      throw new Error(
        getErrorMessage(method, url, response.statusText, payload)
      );
    }

    if (!payload.success) {
      throw new Error(
        getErrorMessage(method, url, 'unsuccessful response', payload)
      );
    }

    return payload.data;
  }

  private get<T>(path: string, query?: VkQueryParams): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  private put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }

  async createRemoteIssue(input: {
    title: string;
    description: string;
    projectId: string;
    statusId: string;
  }): Promise<VkRemoteIssue> {
    const response = await this.post<VkMutationResponse<VkRemoteIssueApi>>(
      '/api/remote/issues',
      {
        project_id: input.projectId,
        status_id: input.statusId,
        title: input.title,
        description: trimToNull(input.description),
        priority: null,
        start_date: null,
        target_date: null,
        completed_at: null,
        sort_order: DEFAULT_ISSUE_SORT_ORDER,
        parent_issue_id: null,
        parent_issue_sort_order: null,
        extension_metadata: {},
      }
    );

    return mapRemoteIssue(response.data);
  }

  async startWorkspace(input: {
    name: string | null;
    prompt: string;
    repos: Array<{
      repoId: string;
      targetBranch: string;
    }>;
    linkedIssue: {
      issueId: string;
      remoteProjectId: string;
    } | null;
    executorConfig: {
      executor: string;
      variant?: string | null;
      modelId?: string | null;
      agentId?: string | null;
      reasoningId?: string | null;
      permissionPolicy?: string | null;
    };
  }): Promise<{
    workspace: VkWorkspace;
    executionProcess: VkExecutionProcess;
  }> {
    const response = await this.post<VkStartWorkspaceResponseApi>(
      '/api/workspaces/start',
      {
        name: trimToNull(input.name),
        prompt: input.prompt,
        repos: input.repos.map((repo) => ({
          repo_id: repo.repoId,
          target_branch: repo.targetBranch,
        })),
        linked_issue: input.linkedIssue
          ? {
              issue_id: input.linkedIssue.issueId,
              remote_project_id: input.linkedIssue.remoteProjectId,
            }
          : null,
        executor_config: {
          executor: input.executorConfig.executor,
          variant: input.executorConfig.variant ?? null,
          model_id: input.executorConfig.modelId ?? null,
          agent_id: input.executorConfig.agentId ?? null,
          reasoning_id: input.executorConfig.reasoningId ?? null,
          permission_policy: input.executorConfig.permissionPolicy ?? null,
        },
        attachment_ids: null,
      }
    );

    return {
      workspace: mapWorkspace(response.workspace),
      executionProcess: mapExecutionProcess(response.execution_process),
    };
  }

  async listWorkspaces(): Promise<VkWorkspace[]> {
    const response = await this.get<VkWorkspaceApi[]>('/api/workspaces');
    return response.map(mapWorkspace);
  }

  async listWorkspaceRepos(workspaceId: string): Promise<VkWorkspaceRepo[]> {
    const response = await this.get<VkWorkspaceRepoApi[]>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/repos`
    );
    return response.map(mapWorkspaceRepo);
  }

  async listWorkspaceSummaries(
    archived: boolean
  ): Promise<VkWorkspaceSummary[]> {
    const response = await this.post<VkWorkspaceSummaryResponseApi>(
      '/api/workspaces/summaries',
      {
        archived,
      }
    );

    return response.summaries.map(mapWorkspaceSummary);
  }

  async listSessions(workspaceId: string): Promise<VkSession[]> {
    const response = await this.get<VkSessionApi[]>('/api/sessions', {
      workspace_id: workspaceId,
    });

    return response.map(mapSession);
  }

  async followUp(
    sessionId: string,
    input: VkFollowUpRequest
  ): Promise<VkExecutionProcess> {
    const response = await this.post<VkExecutionProcessApi>(
      `/api/sessions/${sessionId}/follow-up`,
      {
        prompt: input.message,
        executor_config: {
          executor: input.executorConfig.executor,
          variant: input.executorConfig.variant ?? null,
          model_id: input.executorConfig.modelId ?? null,
          agent_id: input.executorConfig.agentId ?? null,
          reasoning_id: input.executorConfig.reasoningId ?? null,
          permission_policy: input.executorConfig.permissionPolicy ?? null,
        },
        retry_process_id: null,
        force_when_dirty: null,
        perform_git_reset: null,
      }
    );

    return mapExecutionProcess(response);
  }

  async queueFollowUp(
    sessionId: string,
    input: VkFollowUpRequest
  ): Promise<{ status: 'empty' | 'queued' }> {
    const response = await this.post<VkQueueStatusApi>(
      `/api/sessions/${sessionId}/queue`,
      {
        message: input.message,
        executor_config: {
          executor: input.executorConfig.executor,
          variant: input.executorConfig.variant ?? null,
          model_id: input.executorConfig.modelId ?? null,
          agent_id: input.executorConfig.agentId ?? null,
          reasoning_id: input.executorConfig.reasoningId ?? null,
          permission_policy: input.executorConfig.permissionPolicy ?? null,
        },
      }
    );

    return {
      status: response.status,
    };
  }

  async markWorkspaceSeen(workspaceId: string): Promise<void> {
    await this.put<void>(`/api/workspaces/${workspaceId}/seen`);
  }
}

export function createVkBridgeClient(
  config: Pick<MattermostIntegrationConfig['vk'], 'baseUrl' | 'apiKey'> & {
    fetch?: FetchLike;
  }
): VkFetchClient {
  return new VkFetchClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fetch: config.fetch,
  });
}
