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
  latest_session_id?: string | null;
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
  pr_number?: number | null;
  pr_url?: string | null;
}

export interface WorkspaceSummaryResponse {
  summaries: WorkspaceSummary[];
}

export interface Repo {
  id: string;
  name: string;
  display_name: string;
  path?: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface RepoWithBranch {
  id: string;
  name: string;
  display_name: string;
  target_branch: string;
}

export interface PullRequestDetail {
  number: number;
  url: string;
  status: 'open' | 'merged' | 'closed' | 'unknown';
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  title: string;
  base_branch: string;
  head_branch: string;
}

export interface CreateWorkspaceFromPrBody {
  repo_id: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  head_branch: string;
  base_branch: string;
  run_setup: boolean;
  remote_name?: string | null;
}

export interface CreateWorkspaceFromPrResponse {
  workspace: Workspace;
}

// ── API response envelope ───────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string | null;
  error_data?: unknown;
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
      throw new Error(formatApiEnvelopeError('GET', path, json));
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
      throw new Error(formatApiEnvelopeError('POST', path, json));
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

  getWorkspaceBranchStatus(id: string): Promise<unknown> {
    return this.get(`/workspaces/${id}/git/status`);
  }

  getRepos(): Promise<Repo[]> {
    return this.get('/repos');
  }

  getRepoRemotes(repoId: string): Promise<GitRemote[]> {
    return this.get(`/repos/${encodeURIComponent(repoId)}/remotes`);
  }

  getPrInfo(url: string): Promise<PullRequestDetail> {
    return this.get(`/repos/pr-info?url=${encodeURIComponent(url)}`);
  }

  createWorkspaceFromPr(
    body: CreateWorkspaceFromPrBody
  ): Promise<CreateWorkspaceFromPrResponse> {
    return this.post('/workspaces/from-pr', body);
  }

  stopWorkspaceExecution(workspaceId: string): Promise<void> {
    return this.post(`/workspaces/${workspaceId}/execution/stop`, {});
  }
}

export const vkClient = new VibeKanbanClient();

function formatApiEnvelopeError(
  method: string,
  path: string,
  response: ApiResponse<unknown>
): string {
  if (response.message) {
    return response.message;
  }
  if (response.error_data) {
    return `${method} ${path} returned unsuccessful response: ${JSON.stringify(
      response.error_data
    )}`;
  }
  return `${method} ${path} returned unsuccessful response`;
}
