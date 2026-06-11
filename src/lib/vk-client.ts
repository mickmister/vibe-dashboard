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
  latest_process_status: "running" | "completed" | "failed" | "killed" | null;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status: "open" | "merged" | "closed" | "unknown" | null;
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

export interface WorkspaceRepoInput {
  repo_id: string;
  target_branch: string;
}

export interface WorkspaceExecutorConfig {
  executor: string;
  variant?: string | null;
  model_id?: string | null;
  agent_id?: string | null;
  reasoning_id?: string | null;
  permission_policy?: string | null;
}

export interface WorkspaceExecutionProcess {
  id: string;
  session_id: string;
  status: string | null;
  created_at: string;
  updated_at: string;
  started_at: string;
  completed_at: string | null;
}

export interface Session {
  id: string;
  workspace_id: string;
  name: string | null;
  executor: string | null;
  agent_working_dir: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionRequest {
  workspace_id: string;
  executor?: string;
  name?: string;
}

export interface CreateAndStartWorkspaceRequest {
  name: string | null;
  repos: WorkspaceRepoInput[];
  linked_issue: null;
  executor_config: WorkspaceExecutorConfig;
  prompt: string;
  attachment_ids: null;
}

export interface CreateAndStartWorkspaceResponse {
  workspace: Workspace;
  execution_process: WorkspaceExecutionProcess;
}

// ── API response envelope ───────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// ── Client ──────────────────────────────────────────────────────────────────

export class VibeKanbanClient {
  constructor(private baseUrl = "/vk-api") {}

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
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    return this.get("/workspaces");
  }

  getWorkspace(id: string): Promise<Workspace> {
    return this.get(`/workspaces/${id}`);
  }

  getWorkspaceSummaries(archived: boolean): Promise<WorkspaceSummaryResponse> {
    return this.post("/workspaces/summaries", { archived });
  }

  getWorkspaceRepos(id: string): Promise<RepoWithBranch[]> {
    return this.get(`/workspaces/${id}/repos`);
  }

  getWorkspaceBranchStatus(id: string): Promise<unknown> {
    return this.get(`/workspaces/${id}/git/status`);
  }

  getRepos(): Promise<Repo[]> {
    return this.get("/repos");
  }

  createAndStartWorkspace(
    data: CreateAndStartWorkspaceRequest,
  ): Promise<CreateAndStartWorkspaceResponse> {
    return this.post("/workspaces/start", data);
  }

  createSession(data: CreateSessionRequest): Promise<Session> {
    return this.post("/sessions", data);
  }

  stopWorkspaceExecution(workspaceId: string): Promise<void> {
    return this.post(`/workspaces/${workspaceId}/execution/stop`, {});
  }
}

export const vkClient = new VibeKanbanClient();
