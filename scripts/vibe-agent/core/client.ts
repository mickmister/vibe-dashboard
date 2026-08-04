// VibeClient - HTTP REST operations for Vibe Kanban API

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
import { config, type Executor } from '../config.js';
import type {
  Project,
  Task,
  Workspace,
  Repo,
  Session,
  ExecutionProcess,
  WorkspaceSummary,
  ApiResponse,
  CreateSessionBody,
  SendMessageBody,
  UpdateSessionBody,
  ConversationEntry,
} from '../types.js';

export class VibeClient {
  private baseUrl: string;

  constructor(baseUrl: string = config.BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    // Handle 404 - may return empty body
    if (response.status === 404) {
      throw new Error(`Not found: ${url}`);
    }

    // Handle 422 - may return plain text
    if (response.status === 422) {
      const text = await response.text();
      throw new Error(`Validation error: ${text}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = await response.json() as ApiResponse<T>;

    if (!data.success) {
      throw new Error(data.message || JSON.stringify(data.error_data) || 'Unknown error');
    }

    return data.data;
  }

  async getSessionProcesses(sessionId: string): Promise<ExecutionProcess[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.wsEndpoints.sessionProcesses(sessionId));
      const processesById = new Map<string, ExecutionProcess>();

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.JsonPatch) {
          for (const op of msg.JsonPatch) {
            if (op.path === '/execution_processes' && op.value) {
              for (const proc of Object.values(op.value)) {
                const process = proc as ExecutionProcess;
                processesById.set(process.id, process);
              }
            }
            if ((op.op === 'add' || op.op === 'replace') && op.value && op.path !== '/execution_processes') {
              const process = op.value as ExecutionProcess;
              processesById.set(process.id, process);
            }
            if (op.op === 'remove' && String(op.path ?? '').startsWith('/execution_processes/')) {
              processesById.delete(String(op.path).split('/').pop() as string);
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

  // Projects
  async getProjects(): Promise<Project[]> {
    return this.request<Project[]>(config.endpoints.projects);
  }

  // Repos
  async getRepos(): Promise<Repo[]> {
    return this.request<Repo[]>(config.endpoints.repos);
  }

  // Tasks
  async getTasks(projectId: string): Promise<Task[]> {
    return this.request<Task[]>(config.endpoints.tasks(projectId));
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(config.endpoints.task(taskId));
  }

  // Workspaces
  async getWorkspaces(taskId: string): Promise<Workspace[]> {
    return this.request<Workspace[]>(config.endpoints.taskAttemptsByTask(taskId));
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    return this.request<Workspace>(config.endpoints.taskAttempt(workspaceId));
  }

  async getAllWorkspaces(): Promise<Workspace[]> {
    return this.request<Workspace[]>(config.endpoints.workspaces);
  }

  async getWorkspaceSummary(workspaceIds: string[]): Promise<WorkspaceSummary[]> {
    try {
      const allSummaries = await this.request<WorkspaceSummary[]>(
        config.endpoints.taskAttemptSummary,
        {
          method: 'POST',
          body: JSON.stringify({ workspace_ids: workspaceIds }),
        }
      );
      return allSummaries.filter(s => workspaceIds.includes(s.workspace_id));
    } catch {
      const summaries: Array<WorkspaceSummary | null> = await Promise.all(workspaceIds.map(async workspaceId => {
        const sessions = await this.getSessions(workspaceId);
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
          return null;
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
      }));

      return summaries.filter((summary): summary is WorkspaceSummary => summary !== null);
    }
  }

  // Sessions
  async getSessions(workspaceId: string): Promise<Session[]> {
    return this.request<Session[]>(config.endpoints.sessions(workspaceId));
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(config.endpoints.session(sessionId));
  }

  async createSession(body: CreateSessionBody): Promise<Session> {
    return this.request<Session>(config.endpoints.createSession, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateSession(sessionId: string, body: UpdateSessionBody): Promise<Session> {
    return this.request<Session>(config.endpoints.session(sessionId), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async sendMessage(sessionId: string, body: SendMessageBody): Promise<ExecutionProcess> {
    return this.request<ExecutionProcess>(config.endpoints.sessionFollowUp(sessionId), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Execution Processes
  async getExecutionProcess(processId: string): Promise<ExecutionProcess> {
    return this.request<ExecutionProcess>(config.endpoints.executionProcess(processId));
  }



  async fetchConversation(processId: string, timeoutMs = 30 * 60 * 1000): Promise<ConversationEntry[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.wsEndpoints.executionLogs(processId));
      const doc: { entries: ConversationEntry[] } = { entries: [] };
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.terminate();
        resolve(doc.entries);
      };

      const applyPatch = (op: any) => {
        const pathParts = String(op.path ?? '').split('/').filter(Boolean);
        if (pathParts[0] !== 'entries') return;

        if (pathParts.length === 1) {
          if ((op.op === 'add' || op.op === 'replace') && Array.isArray(op.value)) {
            doc.entries = op.value;
          }
          return;
        }

        if (pathParts.length === 2) {
          const idx = Number.parseInt(pathParts[1], 10);
          if (!Number.isInteger(idx)) return;

          if (op.op === 'add') {
            doc.entries.splice(idx, 0, op.value);
          } else if (op.op === 'replace') {
            doc.entries[idx] = op.value;
          } else if (op.op === 'remove') {
            doc.entries.splice(idx, 1);
          }
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.terminate();
        reject(new Error(`Timed out waiting for process ${processId} after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.JsonPatch) {
          for (const op of msg.JsonPatch) {
            applyPatch(op);
          }
        }

        if (msg.Ready !== undefined || msg.finished !== undefined) {
          finish();
        }
      });

      ws.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.terminate();
        reject(err);
      });

      ws.on('close', () => {
        finish();
      });
    });
  }

  // Helper: Find or create session for an executor on a workspace
  async findOrCreateSession(workspaceId: string, executor: Executor): Promise<Session> {
    const sessions = await this.getSessions(workspaceId);
    const existing = sessions.find(s => s.executor === executor);

    if (existing) {
      return existing;
    }

    return this.createSession({
      workspace_id: workspaceId,
      executor,
    });
  }
}

// Singleton instance
export const client = new VibeClient();
