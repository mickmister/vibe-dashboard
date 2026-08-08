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
  name?: string | null;
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

export interface AgentResponse {
  execution_process_id: string;
  session_id: string;
  workspace_id: string;
  status: ExecutionProcess['status'];
  completed_at: string | null;
  coding_agent_turn_id: string | null;
  agent_session_id: string | null;
  agent_message_id: string | null;
  content: string | null;
  truncated: boolean;
  max_chars: number;
  source_kind: 'coding_agent_turn_summary';
}

export type ActivitySessionStatus = 'idle' | 'queued' | 'running' | 'callback_waiting';

export interface ActivityExecutionProcess {
  execution_process_id: string;
  run_reason: string;
  status: ExecutionProcess['status'];
  started_at: string;
  updated_at: string;
}

export interface ActivityQueueSummary {
  count: number;
  queued_count: number;
  leased_count: number;
  starting_count: number;
  running_count: number;
  first_item_id: string | null;
  updated_at: string | null;
}

export interface ActivityCallbackSummary {
  available: boolean;
  waiting_count: number;
}

export interface ActivitySession {
  workspace_id: string;
  session_id: string;
  status: ActivitySessionStatus;
  active_turn_count: number;
  running_execution_processes: ActivityExecutionProcess[];
  queue: ActivityQueueSummary;
  callback: ActivityCallbackSummary;
  updated_at: string;
}

export interface ActivityWorkspace {
  workspace_id: string;
  active_turn_count: number;
  running_turn_count: number;
  running_dev_server_count: number;
  queued_count: number;
  sessions: ActivitySession[];
  updated_at: string;
}

export interface ActivitySnapshot {
  generated_at: string;
  callback_state_available: boolean;
  workspaces: ActivityWorkspace[];
}

export interface LatestResponseCursor {
  afterExecutionProcessId?: string | null;
  afterCompletedAt?: string | null;
}

export interface QueueStatus {
  count: number;
  message: QueuedMessage | null;
  messages: QueuedMessage[];
  status: 'empty' | 'queued';
}

export type QueueFollowUpSource = 'from_user' | 'workflow' | 'agent' | 'system';

export interface QueueFollowUpResponse {
  queued_item: QueuedMessage;
  status: QueueStatus;
}

export interface QueuedMessage {
  id: string;
  session_id: string;
  workspace_id: string;
  status: 'queued' | 'leased' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  source: 'from_user' | 'workflow' | 'agent' | 'system';
  priority: number | bigint;
  data: { message: string; session_command?: unknown | null };
}

export interface CreateSessionBody {
  workspace_id: string;
  executor: Executor;
  name?: string | null;
}

export interface WebhookSubscriptionPublic {
  id: string;
  name: string;
  upsert_key: string | null;
  url: string;
  enabled: boolean;
  event_filters: string[];
  signing_secret_set: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateWebhookSubscriptionBody {
  id?: string | null;
  name: string;
  upsert_key?: string | null;
  url: string;
  enabled: boolean;
  event_filters: string[];
  signing_secret: string;
  allow_external_url: boolean;
}

export interface UpsertWebhookSubscriptionResponse {
  subscription: WebhookSubscriptionPublic;
  created: boolean;
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

  getExecutionProcessFinalMessage(processId: string): Promise<AgentResponse> {
    return this.get(`/execution-processes/${encodeURIComponent(processId)}/final-message`);
  }

  getSessionLatestResponse(sessionId: string, cursor: LatestResponseCursor = {}): Promise<AgentResponse | null> {
    const params = new URLSearchParams();
    if (cursor.afterExecutionProcessId) params.set('afterExecutionProcessId', cursor.afterExecutionProcessId);
    if (cursor.afterCompletedAt) params.set('afterCompletedAt', cursor.afterCompletedAt);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.get(`/sessions/${encodeURIComponent(sessionId)}/latest-response${suffix}`);
  }

  getActivitySnapshot(): Promise<ActivitySnapshot> {
    return this.get('/activity');
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

  createOrUpsertWebhookSubscription(body: CreateWebhookSubscriptionBody): Promise<UpsertWebhookSubscriptionResponse> {
    return this.post('/webhook-subscriptions', body);
  }

  async sendFollowUp(
    sessionId: string,
    prompt: string,
  ): Promise<ExecutionProcess> {
    // Intentional immediate/manual path. Workflow/background callers should use queueFollowUp().
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

  queueFollowUp(
    sessionId: string,
    prompt: string,
    options: { source?: QueueFollowUpSource } = {},
  ): Promise<QueueFollowUpResponse> {
    return this.post(`/sessions/${encodeURIComponent(sessionId)}/queue`, {
      message: prompt,
      source: options.source ?? 'workflow',
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
