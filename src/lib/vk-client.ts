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
  latest_process_status: "running" | "completed" | "failed" | "killed" | null;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status: "open" | "merged" | "closed" | "unknown" | null;
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
  default_target_branch?: string | null;
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
  status: "open" | "merged" | "closed" | "unknown";
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  title: string;
  base_branch: string;
  head_branch: string;
}

export interface EnsureGithubRepoResponse {
  repo: Repo;
  path: string;
  cloned: boolean;
  refreshed: boolean;
  registered: boolean;
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

export interface GithubIssueWorkspaceMapping {
  owner: string;
  repo: string;
  number: number;
  normalizedIssueUrl: string;
  workspaceId: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubIssueWorkspaceMappingResponse {
  mapping: GithubIssueWorkspaceMapping | null;
}

export interface CreateWorkspaceFromIssueBody {
  repo_id: string;
  target_branch: string;
  issue_url: string;
  issue_number: number;
  run_setup: boolean;
}

export interface CreateWorkspaceFromIssueResponse {
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
  constructor(private baseUrl = "/vk-api") {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.statusText}`);
    }
    const json: ApiResponse<T> = await res.json();
    if (!json.success) {
      throw new Error(formatApiEnvelopeError("GET", path, json));
    }
    return json.data;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  private async request<T>(
    method: "POST" | "PUT",
    path: string,
    body: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${method} ${path} failed: ${res.statusText}`);
    }
    const json: ApiResponse<T> = await res.json();
    if (!json.success) {
      throw new Error(formatApiEnvelopeError(method, path, json));
    }
    return json.data;
  }

  private async dashboardGet<T>(path: string): Promise<T> {
    const res = await fetch(path);
    return this.parseDashboardResponse<T>("GET", path, res);
  }

  private async dashboardPut<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.parseDashboardResponse<T>("PUT", path, res);
  }

  private async dashboardPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.parseDashboardResponse<T>("POST", path, res);
  }

  private async parseDashboardResponse<T>(
    method: string,
    path: string,
    res: Response,
  ): Promise<T> {
    const json = (await res.json().catch(() => null)) as
      | { error?: string }
      | T
      | null;
    if (!res.ok) {
      const message =
        json && typeof json === "object" && "error" in json && json.error
          ? json.error
          : res.statusText;
      throw new Error(`${method} ${path} failed: ${message}`);
    }
    return json as T;
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

  getRepoRemotes(repoId: string): Promise<GitRemote[]> {
    return this.get(`/repos/${encodeURIComponent(repoId)}/remotes`);
  }

  getPrInfo(url: string): Promise<PullRequestDetail> {
    return this.get(`/repos/pr-info?url=${encodeURIComponent(url)}`);
  }

  getGithubIssueWorkspaceMapping(args: {
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubIssueWorkspaceMappingResponse> {
    return this.dashboardGet(
      `/dashboard/api/github/issue-workspaces/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/${args.number}`,
    );
  }

  putGithubIssueWorkspaceMapping(args: {
    owner: string;
    repo: string;
    number: number;
    workspaceId: string;
    branch: string;
  }): Promise<GithubIssueWorkspaceMappingResponse> {
    return this.dashboardPut(
      `/dashboard/api/github/issue-workspaces/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/${args.number}`,
      { workspaceId: args.workspaceId, branch: args.branch },
    );
  }

  ensureGithubRepo(repoUrl: string): Promise<EnsureGithubRepoResponse> {
    return this.dashboardPost("/dashboard/api/github/ensure-repo", { repoUrl });
  }

  createWorkspaceFromPr(
    body: CreateWorkspaceFromPrBody,
  ): Promise<CreateWorkspaceFromPrResponse> {
    return this.post("/workspaces/from-pr", body);
  }

  createWorkspaceFromIssue(
    body: CreateWorkspaceFromIssueBody,
  ): Promise<CreateWorkspaceFromIssueResponse> {
    return this.post<{ workspace: Workspace }>("/workspaces/start", {
      name: `Issue #${body.issue_number}`,
      repos: [
        {
          repo_id: body.repo_id,
          target_branch: body.target_branch,
          create_branch: true,
        },
      ],
      linked_issue: null,
      executor_config: { executor: "CODEX" },
      prompt: `Open GitHub issue ${body.issue_url}. Review the issue and prepare the workspace branch for implementation.`,
      attachment_ids: null,
    }).then((response: { workspace: Workspace }) => ({
      workspace: response.workspace,
    }));
  }

  updateWorkspace(
    workspaceId: string,
    body: { archived?: boolean; pinned?: boolean; name?: string },
  ): Promise<Workspace> {
    return this.put(`/workspaces/${encodeURIComponent(workspaceId)}`, body);
  }

  stopWorkspaceExecution(workspaceId: string): Promise<void> {
    return this.post(`/workspaces/${workspaceId}/execution/stop`, {});
  }
}

export const vkClient = new VibeKanbanClient();

function formatApiEnvelopeError(
  method: string,
  path: string,
  response: ApiResponse<unknown>,
): string {
  if (response.message) {
    return response.message;
  }
  if (response.error_data) {
    return `${method} ${path} returned unsuccessful response: ${JSON.stringify(
      response.error_data,
    )}`;
  }
  return `${method} ${path} returned unsuccessful response`;
}
