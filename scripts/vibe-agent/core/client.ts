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

function finalAssistantResponse(entries: ConversationEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.content?.entry_type?.type !== 'assistant_message') continue;
    const content = entry.content.content;
    if (typeof content === 'string' && content.trim()) return content;
  }
  return null;
}
import { config, type Executor } from '../config.js';
import type {
  Project,
  Task,
  Workspace,
  Repo,
  Session,
  ExecutionProcess,
  ExecutionProcessFinalResponse,
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

  private url(path: string): string { return `${this.baseUrl.replace(/\/$/, '')}${path}`; }
  private wsUrl(path: string): string { return this.url(path).replace(/^http/, 'ws'); }

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
      const ws = new WebSocket(this.wsUrl(`/api/execution-processes/stream/session/ws?session_id=${encodeURIComponent(sessionId)}`));
      const processesById = new Map<string, ExecutionProcess>();
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const finish = () => { if (settled) return; settled = true; if (timeout) clearTimeout(timeout); ws.terminate(); resolve(Array.from(processesById.values())); };
      const fail = (error: Error) => { if (settled) return; settled = true; if (timeout) clearTimeout(timeout); ws.terminate(); reject(error); };

      ws.on('message', (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch (error) { fail(new Error(`Invalid session process WebSocket message: ${(error as Error).message}`)); return; }

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
          finish();
        }
      });

      ws.on('error', fail);
      ws.on('close', () => fail(new Error(`Session process WebSocket closed before Ready for ${sessionId}`)));

      timeout = setTimeout(finish, 2000);
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
    return this.request<Workspace[]>(this.url('/api/workspaces'));
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
        if (!latestProcess) return null;

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
    return this.request<Session[]>(this.url(`/api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`));
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(this.url(`/api/sessions/${encodeURIComponent(sessionId)}`));
  }

  async createSession(body: CreateSessionBody): Promise<Session> {
    return this.request<Session>(this.url('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateSession(sessionId: string, body: UpdateSessionBody): Promise<Session> {
    return this.request<Session>(this.url(`/api/sessions/${encodeURIComponent(sessionId)}`), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async sendMessage(sessionId: string, body: SendMessageBody): Promise<ExecutionProcess> {
    return this.request<ExecutionProcess>(this.url(`/api/sessions/${encodeURIComponent(sessionId)}/follow-up`), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Execution Processes
  async getExecutionProcess(processId: string): Promise<ExecutionProcess> {
    return this.request<ExecutionProcess>(this.url(`/api/execution-processes/${encodeURIComponent(processId)}`));
  }

  async getExecutionProcessFinalResponse(processId: string): Promise<ExecutionProcessFinalResponse> {
    try {
      return await this.request<ExecutionProcessFinalResponse>(this.url(`/api/execution-processes/${encodeURIComponent(processId)}/final-response`));
    } catch {
      const process = await this.getExecutionProcess(processId);
      const entries = await this.fetchConversation(processId, 5_000);
      const finalResponse = finalAssistantResponse(entries);
      const finished = process.status !== 'running';
      return {
        process_id: process.id,
        status: process.status,
        finished,
        final_response: finalResponse,
        terminal_no_response: finished && finalResponse == null,
      };
    }
  }



  async fetchConversation(processId: string, timeoutMs = 30 * 60 * 1000, signal?: AbortSignal): Promise<ConversationEntry[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl(`/api/execution-processes/${encodeURIComponent(processId)}/normalized-logs/ws`));
      const doc: { entries: ConversationEntry[] } = { entries: [] };
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.terminate();
        signal?.removeEventListener('abort', abort);
        resolve(doc.entries);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.terminate();
        signal?.removeEventListener('abort', abort);
        reject(error);
      };

      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.terminate();
        reject(new Error(`Cancelled while waiting for process ${processId}`));
      };

      const applyPatch = (op: any) => {
        if (!['add', 'replace', 'remove'].includes(String(op.op))) throw new Error(`Invalid normalized-log patch operation: ${String(op.op)}`);
        const pathParts = String(op.path ?? '').split('/').filter(Boolean);
        if (pathParts[0] !== 'entries') return;

        if (pathParts.length === 1) {
          if ((op.op === 'add' || op.op === 'replace') && Array.isArray(op.value)) {
            doc.entries = op.value;
          }
          return;
        }

        if (pathParts.length === 2) {
          const idx = Number.parseInt(pathParts[1]!, 10);
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
        signal?.removeEventListener('abort', abort);
        ws.terminate();
        reject(new Error(`Timed out waiting for process ${processId} after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.on('message', (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch (error) { fail(new Error(`Invalid normalized-log WebSocket message: ${(error as Error).message}`)); return; }

        if (msg.JsonPatch) {
          try { for (const op of msg.JsonPatch) applyPatch(op); }
          catch (error) { fail(error as Error); return; }
        }

        if (msg.Ready !== undefined || msg.finished !== undefined) {
          finish();
        }
      });

      ws.on('error', fail);

      ws.on('close', () => {
        fail(new Error(`Normalized-log WebSocket closed before Ready for ${processId}`));
      });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
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
