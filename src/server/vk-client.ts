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
