export type Executor =
  | 'CLAUDE_CODE'
  | 'CODEX'
  | 'GEMINI'
  | 'AMP'
  | 'CURSOR_AGENT'
  | 'COPILOT'
  | 'DROID'
  | 'OPENCODE'
  | 'QWEN_CODE';

export interface Workspace {
  id: string;
  task_id: string;
  container_ref: string | null;
  branch: string;
  agent_working_dir: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  pinned: boolean;
  name: string | null;
}

export interface WorkspaceSummary {
  workspace_id: string;
  latest_session_id: string | null;
  has_pending_approval: boolean;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  latest_process_completed_at?: string | null;
  latest_process_status?: 'running' | 'completed' | 'failed' | 'killed' | null;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status?: string | null;
  pr_number?: number | null;
  pr_url?: string | null;
}

export interface WorkspaceSummaryResponse {
  summaries: WorkspaceSummary[];
}

export interface RepoWithBranch {
  id: string;
  name: string;
  display_name: string;
  target_branch: string;
}

export interface Session {
  id: string;
  workspace_id: string;
  executor: Executor;
  created_at: string;
  updated_at: string;
}

export interface ExecutionProcess {
  id: string;
  session_id: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  created_at?: string;
  started_at?: string;
  completed_at?: string | null;
  updated_at?: string;
  exit_code?: number | null;
  dropped?: boolean;
  run_reason?: string;
  executor_action?: unknown;
}

export interface PreviewResolveRequest {
  host: string;
  workspaceToken: string;
  repoSlug: string;
  slotSlug: string;
  customerSlug: string;
  ensure: boolean;
  method: string;
  path: string;
}

export interface PreviewResolveResponse {
  status: 'ready' | 'starting' | 'not_found' | 'capacity_full' | 'failed' | 'unavailable' | 'error';
  upstream?: string | null;
  message?: string | null;
  executionProcessId?: string | null;
}

export type RunConfigKind = 'long_running' | 'one_shot' | 'test';

export interface RunConfig {
  id: string;
  repo_id: string;
  slug: string;
  name: string;
  command: string;
  working_dir?: string | null;
  kind: RunConfigKind;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertRunConfig {
  id?: string | null;
  repo_id: string;
  slug: string;
  name: string;
  command: string;
  working_dir?: string | null;
  kind: RunConfigKind;
  enabled?: boolean;
}

export interface PreviewSlot {
  id: string;
  repo_id: string;
  run_config_id: string;
  slot_slug: string;
  title: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertPreviewSlot {
  id?: string | null;
  repo_id: string;
  run_config_id: string;
  slot_slug: string;
  title: string;
  enabled?: boolean;
}

export interface PreviewProcessLink {
  id: string;
  workspace_id: string;
  repo_id: string;
  run_config_id: string;
  preview_slot_id?: string | null;
  execution_process_id: string;
  assigned_port: number;
  status_snapshot: 'starting' | 'ready' | 'failed' | 'stopped';
  started_at: string;
  updated_at: string;
  ended_at?: string | null;
}

export interface RunConfigStartResponse {
  execution_process: ExecutionProcess;
  preview_process_link: PreviewProcessLink;
  upstream: string;
}

export interface PreviewSlotUrlParts {
  previewSlotId: string;
  workspaceToken: string;
  repoSlug: string;
  slotSlug: string;
}

export interface WorkspaceRunConfigsResponse {
  run_configs: RunConfig[];
  preview_slots: PreviewSlot[];
  preview_url_parts: PreviewSlotUrlParts[];
}

export interface PreviewSlotUrlResponse extends PreviewSlotUrlParts {
  customerSlug: string;
  host: string;
  url: string;
}

export interface CreateSessionBody {
  workspace_id: string;
  executor: Executor;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error_data?: unknown;
  message?: string | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface VibeKanbanServerClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

export class VkApiError extends Error {
  readonly status?: number;
  readonly bodyText?: string;
  readonly errorData?: unknown;

  constructor(args: {
    message: string;
    status?: number;
    bodyText?: string;
    errorData?: unknown;
  }) {
    super(args.message);
    this.name = 'VkApiError';
    this.status = args.status;
    this.bodyText = args.bodyText;
    this.errorData = args.errorData;
  }
}

export function resolveVibeApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.VIBE_API_URL || env.VK_API_URL || 'http://localhost:3007';
  const withoutTrailingSlash = configured.replace(/\/+$/, '');
  if (withoutTrailingSlash.endsWith('/api')) {
    return withoutTrailingSlash;
  }
  return `${withoutTrailingSlash}/api`;
}

export class VibeKanbanServerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: VibeKanbanServerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveVibeApiBaseUrl()).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  getWorkspaces(): Promise<Workspace[]> {
    return this.get('/workspaces');
  }

  getWorkspaceSummaries(archived = false): Promise<WorkspaceSummary[]> {
    return this.post<WorkspaceSummaryResponse>('/workspaces/summaries', { archived })
      .then((response) => response.summaries);
  }

  getWorkspace(workspaceId: string): Promise<Workspace> {
    return this.get(`/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  getWorkspaceRepos(workspaceId: string): Promise<RepoWithBranch[]> {
    return this.get(`/workspaces/${encodeURIComponent(workspaceId)}/repos`);
  }

  getSessions(workspaceId: string): Promise<Session[]> {
    return this.get(`/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
  }

  getSession(sessionId: string): Promise<Session> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  createSession(body: CreateSessionBody): Promise<Session> {
    return this.post('/sessions', body);
  }

  getExecutionProcess(processId: string): Promise<ExecutionProcess> {
    return this.get(`/execution-processes/${encodeURIComponent(processId)}`);
  }

  async stopExecutionProcess(processId: string): Promise<void> {
    await this.post(`/execution-processes/${encodeURIComponent(processId)}/stop`, {});
  }

  async checkHealth(): Promise<void> {
    await this.get('/health');
  }

  async getInfo(): Promise<unknown> {
    return this.get('/info');
  }

  resolvePreview(request: PreviewResolveRequest): Promise<PreviewResolveResponse> {
    return this.post('/preview/resolve', request);
  }

  getRunConfigs(workspaceId: string): Promise<WorkspaceRunConfigsResponse> {
    return this.get(`/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs`);
  }

  upsertRunConfig(workspaceId: string, body: UpsertRunConfig): Promise<RunConfig> {
    return this.post(`/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs`, body);
  }

  upsertPreviewSlot(workspaceId: string, body: UpsertPreviewSlot): Promise<PreviewSlot> {
    return this.post(`/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots`, body);
  }

  startRunConfig(workspaceId: string, runConfigId: string): Promise<RunConfigStartResponse> {
    return this.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs/${encodeURIComponent(runConfigId)}/start`,
      {},
    );
  }

  startPreviewSlot(workspaceId: string, previewSlotId: string): Promise<RunConfigStartResponse> {
    return this.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/${encodeURIComponent(previewSlotId)}/start`,
      {},
    );
  }

  getPreviewSlotUrl(
    workspaceId: string,
    previewSlotId: string,
    args: { customerSlug: string; baseDomain?: string },
  ): Promise<PreviewSlotUrlResponse> {
    const params = new URLSearchParams({ customerSlug: args.customerSlug });
    if (args.baseDomain) params.set('baseDomain', args.baseDomain);
    return this.get(
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/${encodeURIComponent(previewSlotId)}/url?${params}`,
    );
  }

  async sendFollowUp(
    sessionId: string,
    prompt: string,
  ): Promise<ExecutionProcess> {
    const session = await this.getSession(sessionId);
    return this.post(`/sessions/${encodeURIComponent(sessionId)}/follow-up`, {
      prompt,
      executor_config: {
        executor: session.executor,
      },
      retry_process_id: null,
      force_when_dirty: null,
      perform_git_reset: null,
    });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new VkApiError({
        message: `VK API ${path} failed: HTTP ${response.status} ${response.statusText}`,
        status: response.status,
        bodyText,
      });
    }

    let envelope: ApiEnvelope<T>;
    try {
      envelope = JSON.parse(bodyText) as ApiEnvelope<T>;
    } catch (error) {
      throw new VkApiError({
        message: `VK API ${path} returned invalid JSON`,
        status: response.status,
        bodyText,
        errorData: error,
      });
    }

    if (!envelope.success) {
      throw new VkApiError({
        message: envelope.message || `VK API ${path} returned unsuccessful response`,
        status: response.status,
        bodyText,
        errorData: envelope.error_data,
      });
    }

    return envelope.data;
  }
}

export function selectLatestSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  return [...sessions].sort(
    (a, b) => parseTimestamp(b.created_at) - parseTimestamp(a.created_at),
  )[0] ?? null;
}

function parseTimestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
