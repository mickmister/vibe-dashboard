// ── VK Backend API types ────────────────────────────────────────────────────

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
  has_pending_approval: boolean;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  latest_process_completed_at?: string;
  latest_process_status:
    | 'running'
    | 'completed'
    | 'failed'
    | 'killed'
    | null;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status: 'open' | 'merged' | 'closed' | 'unknown' | null;
}

export interface WorkspaceSummaryResponse {
  summaries: WorkspaceSummary[];
}

export interface Repo {
  id: string;
  name: string;
  display_name: string;
}

export interface RepoWithBranch {
  id: string;
  name: string;
  display_name: string;
  target_branch: string;
}

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

export interface Session {
  id: string;
  workspace_id: string;
  executor: Executor;
  name?: string | null;
  created_at: string;
  updated_at: string;
}

export type ActivitySessionStatus = 'idle' | 'queued' | 'running' | 'callback_waiting';

export interface ActivityExecutionProcess {
  execution_process_id: string;
  run_reason: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
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
  workspaces: ActivityWorkspace[];
}

// ── API response envelope ───────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// ── Client ──────────────────────────────────────────────────────────────────

export class VibeKanbanClient {
  constructor(private baseUrl = '/vk-api') {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.statusText}`);
    }
    const json: ApiResponse<T> = await res.json();
    if (!json.success) {
      throw new Error(`GET ${path} returned unsuccessful response`);
    }
    return json.data;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.statusText}`);
    }
    const json: ApiResponse<T> = await res.json();
    if (!json.success) {
      throw new Error(`POST ${path} returned unsuccessful response`);
    }
    return json.data;
  }

  getWorkspaces(): Promise<Workspace[]> {
    return this.get('/workspaces');
  }

  getWorkspace(id: string): Promise<Workspace> {
    return this.get(`/workspaces/${id}`);
  }

  getWorkspaceSummaries(
    archived: boolean
  ): Promise<WorkspaceSummaryResponse> {
    return this.post('/workspaces/summaries', { archived });
  }

  getWorkspaceRepos(id: string): Promise<RepoWithBranch[]> {
    return this.get(`/workspaces/${id}/repos`);
  }

  getSessions(workspaceId: string): Promise<Session[]> {
    return this.get(`/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
  }

  createSession(body: { workspace_id: string; executor: Executor; name?: string | null }): Promise<Session> {
    return this.post('/sessions', body);
  }

  getActivitySnapshot(): Promise<ActivitySnapshot> {
    return this.get('/activity');
  }

  getWorkspaceBranchStatus(id: string): Promise<unknown> {
    return this.get(`/workspaces/${id}/git/status`);
  }

  getRepos(): Promise<Repo[]> {
    return this.get('/repos');
  }

  stopWorkspaceExecution(workspaceId: string): Promise<void> {
    return this.post(`/workspaces/${workspaceId}/execution/stop`, {});
  }
}

export const vkClient = new VibeKanbanClient();
