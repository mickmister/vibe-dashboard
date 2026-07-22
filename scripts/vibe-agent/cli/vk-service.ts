// Vibe Kanban Service Layer - API interactions for PM operations
type WebSocketMessageHandler = (data: string | Buffer) => void;
type WebSocketErrorHandler = (error: Error) => void;
type WebSocketCloseHandler = () => void;

class WebSocket {
  private socket: globalThis.WebSocket;

  constructor(url: string) {
    if (!globalThis.WebSocket) {
      throw new Error('Global WebSocket is unavailable in this Node.js runtime');
    }
    this.socket = new globalThis.WebSocket(url);
  }

  on(event: 'message', handler: WebSocketMessageHandler): this;
  on(event: 'error', handler: WebSocketErrorHandler): this;
  on(event: 'close', handler: WebSocketCloseHandler): this;
  on(event: 'message' | 'error' | 'close', handler: WebSocketMessageHandler | WebSocketErrorHandler | WebSocketCloseHandler): this {
    if (event === 'message') {
      this.socket.addEventListener('message', (messageEvent) => {
        (handler as WebSocketMessageHandler)(normalizeWebSocketMessageData(messageEvent.data));
      });
      return this;
    }
    if (event === 'error') {
      this.socket.addEventListener('error', (errorEvent) => {
        const maybeError = 'error' in errorEvent ? errorEvent.error : null;
        (handler as WebSocketErrorHandler)(maybeError instanceof Error ? maybeError : new Error('WebSocket error'));
      });
      return this;
    }
    if (event === 'close') {
      this.socket.addEventListener('close', () => {
        (handler as WebSocketCloseHandler)();
      });
    }
    return this;
  }

  terminate(): void {
    this.socket.close();
  }
}

function normalizeWebSocketMessageData(data: unknown): string | Buffer {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return String(data);
}
import { config, Executor } from './vk-config.js';

// Type definitions
export interface Project {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  task_id: string | null;
  container_ref: string | null;
  branch?: string;
  agent_working_dir?: string | null;
  setup_completed_at?: string | null;
  archived?: boolean;
  pinned?: boolean;
  name?: string | null;
  worktree_deleted?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  workspace_id: string;
  executor: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutionProcess {
  id: string;
  session_id: string;
  run_reason?: string;
  status: string;
  exit_code?: number | null;
  dropped?: boolean;
  started_at?: string;
  created_at: string;
  completed_at: string | null;
  updated_at?: string;
  executor_action?: {
    typ?: {
      prompt?: string;
      script?: string;
      context?: string;
      working_dir?: string | null;
    };
  };
}

export interface WorkspaceSummary {
  workspace_id: string;
  latest_session_id: string | null;
  latest_process_status: string;
  latest_process_completed_at: string | null;
  has_pending_approval: boolean;
  has_running_dev_server: boolean;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  has_unseen_turns: boolean;
  pr_status: string | null;
}

export interface Repo {
  id: string;
  name: string;
  display_name?: string;
  path: string;
  setup_script?: string | null;
  cleanup_script?: string | null;
  archive_script?: string | null;
  copy_files?: string | null;
  parallel_setup_script?: boolean;
  dev_server_script?: string | null;
  default_target_branch?: string | null;
  default_working_dir?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RepoWithTargetBranch extends Repo {
  target_branch: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface PullRequestDetail {
  number: number;
  url: string;
  status?: unknown;
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

export interface WorkspaceRepoInput {
  repo_id: string;
  target_branch: string;
}

export interface ExecutorConfig {
  executor: Executor;
  variant?: string;
}

export interface StartWorkspaceBody {
  message: string;
  repos: WorkspaceRepoInput[];
  executor_config: ExecutorConfig;
  linked_issue: null;
  attachments: unknown[];
}

export interface StartWorkspaceResult {
  workspace: Workspace;
  session?: Session | null;
  execution_process?: ExecutionProcess | null;
}

export interface RawLogEntry {
  type: 'STDOUT' | 'STDERR';
  content: string;
}

export interface ConversationEntry {
  content?: {
    entry_type?: {
      type?: string;
    };
    content?: string | unknown;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error_data?: unknown;
  message?: string | null;
}

// Service class
export class VKService {
  private getPromptFromProcess(process: ExecutionProcess): string | null {
    return process.executor_action?.typ?.prompt || null;
  }

  private async buildWorkspaceSummary(workspaceId: string): Promise<WorkspaceSummary | null> {
    const sessions = await this.listSessions(workspaceId);
    if (sessions.length === 0) {
      return null;
    }

    const processes = (await Promise.all(
      sessions.map(async session => {
        const sessionProcesses = await this.getSessionProcesses(session.id);
        return sessionProcesses.map(process => ({ ...process, session_id: session.id }));
      })
    )).flat();

    if (processes.length === 0) {
      return {
        workspace_id: workspaceId,
        latest_session_id: sessions.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )[0]?.id ?? null,
        latest_process_status: 'unknown',
        latest_process_completed_at: null,
        has_pending_approval: false,
        has_running_dev_server: false,
        files_changed: null,
        lines_added: null,
        lines_removed: null,
        has_unseen_turns: false,
        pr_status: null,
      };
    }

    const latestProcess = processes.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    return {
      workspace_id: workspaceId,
      latest_session_id: latestProcess.session_id,
      latest_process_status: latestProcess.status,
      latest_process_completed_at: latestProcess.completed_at,
      has_pending_approval: false,
      has_running_dev_server: false,
      files_changed: null,
      lines_added: null,
      lines_removed: null,
      has_unseen_turns: false,
      pr_status: null,
    };
  }

  private async parseApiResponse<T>(response: Response, action: string): Promise<T> {
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const looksJson = contentType.includes('application/json') || text.trim().startsWith('{');

    if (!response.ok) {
      throw new Error(`Failed to ${action}: ${text.trim() || `HTTP ${response.status}`}`);
    }

    if (!looksJson) {
      throw new Error(
        `Failed to ${action}: expected JSON response, got: ${text.trim() || '<empty body>'}`
      );
    }

    let data: ApiResponse<T>;
    try {
      data = JSON.parse(text) as ApiResponse<T>;
    } catch (err) {
      throw new Error(
        `Failed to ${action}: invalid JSON response: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!data.success) {
      const detail = data.message ?? JSON.stringify(data.error_data) ?? 'Unknown error';
      throw new Error(`Failed to ${action}: ${detail}`);
    }

    return data.data;
  }


  // Repositories
  async listRepos(options?: { recent?: boolean }): Promise<Repo[]> {
    const response = await fetch(options?.recent ? config.endpoints.recentRepos : config.endpoints.repos);
    return this.parseApiResponse<Repo[]>(response, 'fetch repos');
  }

  async getRepo(repoId: string): Promise<Repo> {
    const response = await fetch(config.endpoints.repo(repoId));
    return this.parseApiResponse<Repo>(response, 'fetch repo');
  }

  async updateRepo(repoId: string, payload: Partial<Repo>): Promise<Repo> {
    const response = await fetch(config.endpoints.repo(repoId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.parseApiResponse<Repo>(response, 'update repo');
  }

  async setDevServerScript(repoId: string, script: string | null): Promise<Repo> {
    return this.updateRepo(repoId, { dev_server_script: script });
  }

  async getWorkspaceRepos(workspaceId: string): Promise<RepoWithTargetBranch[]> {
    const response = await fetch(config.endpoints.taskAttemptRepos(workspaceId));
    return this.parseApiResponse<RepoWithTargetBranch[]>(response, 'fetch workspace repos');
  }

  async listRepoRemotes(repoId: string): Promise<GitRemote[]> {
    const response = await fetch(config.endpoints.repoRemotes(repoId));
    return this.parseApiResponse<GitRemote[]>(response, 'fetch repo remotes');
  }

  async listOpenPrs(repoId: string, remoteName?: string): Promise<PullRequestDetail[]> {
    const response = await fetch(config.endpoints.repoPullRequests(repoId, remoteName));
    return this.parseApiResponse<PullRequestDetail[]>(response, 'fetch open pull requests');
  }

  async getPrInfo(prUrl: string): Promise<PullRequestDetail> {
    const response = await fetch(config.endpoints.repoPrInfo(prUrl));
    return this.parseApiResponse<PullRequestDetail>(response, 'fetch pull request info');
  }

  // Workspaces
  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const response = await fetch(config.endpoints.workspace(workspaceId));
    return this.parseApiResponse<Workspace>(response, 'fetch workspace');
  }

  async getWorkspaces(taskId: string): Promise<Workspace[]> {
    const response = await fetch(config.endpoints.taskAttempts(taskId));
    return this.parseApiResponse<Workspace[]>(response, 'fetch workspaces');
  }

  async createWorkspaceFromPr(body: CreateWorkspaceFromPrBody): Promise<CreateWorkspaceFromPrResponse> {
    const response = await fetch(config.endpoints.createWorkspaceFromPr, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parseApiResponse<CreateWorkspaceFromPrResponse>(response, 'create workspace from PR');
  }

  async startWorkspace(body: StartWorkspaceBody): Promise<StartWorkspaceResult> {
    const response = await fetch(config.endpoints.startWorkspace, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await this.parseApiResponse<Workspace | StartWorkspaceResult>(response, 'start workspace');

    if ('workspace' in data) {
      return data;
    }

    return { workspace: data };
  }

  async getWorkspaceSummaries(workspaceIds: string[]): Promise<WorkspaceSummary[]> {
    try {
      const response = await fetch(config.endpoints.taskAttemptSummary, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_ids: workspaceIds,
          archived: false,
        }),
      });
      const data = await this.parseApiResponse<{ summaries: WorkspaceSummary[] }>(
        response,
        'fetch workspace summaries'
      );

      return data.summaries.filter(s => workspaceIds.includes(s.workspace_id));
    } catch {
      const summaries = await Promise.all(workspaceIds.map(id => this.buildWorkspaceSummary(id)));
      return summaries.filter((summary): summary is WorkspaceSummary => summary !== null);
    }
  }

  // Sessions
  async listSessions(workspaceId: string): Promise<Session[]> {
    const response = await fetch(config.endpoints.sessions(workspaceId));
    return this.parseApiResponse<Session[]>(response, 'fetch sessions');
  }

  async getSession(sessionId: string): Promise<Session> {
    const response = await fetch(config.endpoints.session(sessionId));
    return this.parseApiResponse<Session>(response, 'fetch session');
  }

  async createSession(workspaceId: string, executor: Executor): Promise<Session> {
    const response = await fetch(config.endpoints.createSession, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        executor: executor,
      }),
    });
    return this.parseApiResponse<Session>(response, 'create session');
  }

  async sendMessage(sessionId: string, prompt: string): Promise<ExecutionProcess> {
    // Intentional immediate/manual CLI path. Workflow/background callers should use the guarded queue path.
    const session = await this.getSession(sessionId);

    if (!session.executor) {
      throw new Error(`Failed to send message: session ${sessionId} has no executor`);
    }

    const response = await fetch(config.endpoints.sessionFollowUp(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        executor_config: {
          executor: session.executor as Executor,
        },
        retry_process_id: null,
        force_when_dirty: null,
        perform_git_reset: null,
      }),
    });
    return this.parseApiResponse<ExecutionProcess>(response, 'send message');
  }

  // Dev servers
  async startDevServer(workspaceId: string): Promise<ExecutionProcess[]> {
    const response = await fetch(config.endpoints.startDevServer(workspaceId), { method: 'POST' });
    return this.parseApiResponse<ExecutionProcess[]>(response, 'start dev server');
  }

  async getExecutionProcess(processId: string): Promise<ExecutionProcess> {
    const response = await fetch(config.endpoints.executionProcess(processId));
    return this.parseApiResponse<ExecutionProcess>(response, 'fetch execution process');
  }

  async stopExecutionProcess(processId: string): Promise<void> {
    const response = await fetch(config.endpoints.stopExecutionProcess(processId), { method: 'POST' });
    return this.parseApiResponse<void>(response, 'stop execution process');
  }

  async listRunningDevServers(workspaceId: string): Promise<ExecutionProcess[]> {
    const sessions = await this.listSessions(workspaceId);
    const processes = (await Promise.all(
      sessions.map(async session => {
        const sessionProcesses = await this.getSessionProcesses(session.id);
        return sessionProcesses.map(process => ({ ...process, session_id: process.session_id || session.id }));
      })
    )).flat();

    return processes
      .filter(process => process.run_reason === 'devserver' && process.status === 'running')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async fetchRawLogs(processId: string, timeoutMs = 2000): Promise<RawLogEntry[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.wsEndpoints.rawExecutionLogs(processId));
      const logs: RawLogEntry[] = [];

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.JsonPatch) {
          for (const op of msg.JsonPatch) {
            const value = op.value;
            if (value?.type === 'STDOUT' || value?.type === 'STDERR') {
              logs.push({ type: value.type, content: value.content ?? '' });
            }
          }
        }

        if (msg.finished === true || msg.Ready !== undefined) {
          ws.terminate();
          resolve(logs);
        }
      });

      ws.on('error', (err) => {
        ws.terminate();
        reject(err);
      });

      setTimeout(() => {
        ws.terminate();
        resolve(logs);
      }, timeoutMs);
    });
  }

  // Execution Processes
  async getSessionProcesses(sessionId: string): Promise<ExecutionProcess[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.wsEndpoints.sessionProcesses(sessionId));
      const processesById = new Map<string, ExecutionProcess>();

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.JsonPatch) {
          for (const op of msg.JsonPatch) {
            // Handle replace on /execution_processes with map structure
            if (op.path === '/execution_processes' && op.value) {
              for (const proc of Object.values(op.value)) {
                const process = proc as ExecutionProcess;
                processesById.set(process.id, process);
              }
            }
            // Handle individual adds
            if ((op.op === 'add' || op.op === 'replace') && op.value && op.path !== '/execution_processes') {
              const process = op.value as ExecutionProcess;
              processesById.set(process.id, process);
            }
            if (op.op === 'remove' && op.path.startsWith('/execution_processes/')) {
              processesById.delete(op.path.split('/').pop() as string);
            }
          }
        }

        if (msg.Ready !== undefined) {
          ws.terminate();
          resolve(Array.from(processesById.values()));
        }
      });

      ws.on('error', (err) => {
        ws.terminate();
        reject(err);
      });

      setTimeout(() => {
        ws.terminate();
        resolve(Array.from(processesById.values()));
      }, 2000);
    });
  }

  async fetchConversation(
    processId: string,
    options?: { showAll?: boolean; json?: boolean }
  ): Promise<ConversationEntry[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.wsEndpoints.executionLogs(processId));
      const doc: { entries: ConversationEntry[] } = { entries: [] };

      const applyPatch = (doc: { entries: ConversationEntry[] }, op: any) => {
        const pathParts = op.path.split('/').filter((p: string) => p);

        if (pathParts[0] === 'entries') {
          if (pathParts.length === 1) {
            // /entries - the initial array
            if (op.op === 'add' || op.op === 'replace') {
              doc.entries = op.value;
            }
          } else if (pathParts.length === 2) {
            // /entries/N - add or replace an entry
            const idx = parseInt(pathParts[1], 10);
            if (op.op === 'add') {
              doc.entries.splice(idx, 0, op.value);
            } else if (op.op === 'replace') {
              doc.entries[idx] = op.value;
            }
          }
        }
      };

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.JsonPatch) {
          for (const op of msg.JsonPatch) {
            applyPatch(doc, op);
          }
        }

        // Close on Ready signal for completed processes, or finished for active ones
        if (msg.Ready !== undefined || msg.finished !== undefined) {
          ws.terminate();
          resolve(doc.entries);
        }
      });

      ws.on('error', (err) => {
        ws.terminate();
        reject(err);
      });

      setTimeout(() => {
        ws.terminate();
        resolve(doc.entries);
      }, 2000);
    });
  }

  // High-level summary method
  async getSessionSummary(workspaceId: string): Promise<{
    session: Session;
    latestUserMessage: string | null;
    latestAgentMessage: string | null;
  }[]> {
    const sessions = await this.listSessions(workspaceId);
    const summaries = [];

    for (const session of sessions) {
      const processes = await this.getSessionProcesses(session.id);

      if (processes.length === 0) {
        summaries.push({
          session,
          latestUserMessage: null,
          latestAgentMessage: null,
        });
        continue;
      }

      // Get the latest process
      const latestProcess = processes[processes.length - 1];

      // Fetch conversation for latest process
      const entries = await this.fetchConversation(latestProcess.id);

      // Find last user and agent messages
      let latestUserMessage: string | null = this.getPromptFromProcess(latestProcess);
      let latestAgentMessage: string | null = null;

      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        const entryType = entry.content?.entry_type?.type;
        const content = entry.content?.content;

        if (entryType === 'user_message' && !latestUserMessage && typeof content === 'string') {
          latestUserMessage = content;
        }

        if (entryType === 'assistant_message' && !latestAgentMessage && typeof content === 'string') {
          latestAgentMessage = content;
        }

        // Stop once we have both
        if (latestUserMessage && latestAgentMessage) {
          break;
        }
      }

      summaries.push({
        session,
        latestUserMessage,
        latestAgentMessage,
      });
    }

    // Sort by most recent session update
    summaries.sort((a, b) =>
      new Date(b.session.updated_at).getTime() - new Date(a.session.updated_at).getTime()
    );

    return summaries;
  }
}
