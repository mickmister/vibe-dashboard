// VibeClient - HTTP REST operations for Vibe Kanban API
const NativeWebSocket = globalThis.WebSocket;
class WebSocket {
    constructor(url) {
        if (!NativeWebSocket) {
            throw new Error('Global WebSocket is unavailable in this Node.js runtime');
        }
        this.socket = new NativeWebSocket(url);
    }
    on(event, handler) {
        if (event === 'message') {
            this.socket.addEventListener('message', (messageEvent) => {
                handler(normalizeWebSocketMessageData(messageEvent.data));
            });
            return this;
        }
        if (event === 'error') {
            this.socket.addEventListener('error', (errorEvent) => {
                handler(errorEvent.error ?? new Error('WebSocket error'));
            });
            return this;
        }
        if (event === 'close') {
            this.socket.addEventListener('close', () => {
                handler();
            });
            return this;
        }
        return this;
    }
    terminate() {
        this.socket.close();
    }
}
function normalizeWebSocketMessageData(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return String(data);
}
import { config } from '../config.js';
export class VibeClient {
    baseUrl;
    constructor(baseUrl = config.BASE_URL) {
        this.baseUrl = baseUrl;
    }
    async request(url, options) {
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
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || JSON.stringify(data.error_data) || 'Unknown error');
        }
        return data.data;
    }
    async getSessionProcesses(sessionId) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(config.wsEndpoints.sessionProcesses(sessionId));
            const processesById = new Map();
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.JsonPatch) {
                    for (const op of msg.JsonPatch) {
                        if (op.path === '/execution_processes' && op.value) {
                            for (const proc of Object.values(op.value)) {
                                const process = proc;
                                processesById.set(process.id, process);
                            }
                        }
                        if ((op.op === 'add' || op.op === 'replace') && op.value && op.path !== '/execution_processes') {
                            const process = op.value;
                            processesById.set(process.id, process);
                        }
                        if (op.op === 'remove' && String(op.path ?? '').startsWith('/execution_processes/')) {
                            processesById.delete(String(op.path).split('/').pop());
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
    async getProjects() {
        return this.request(config.endpoints.projects);
    }
    // Repos
    async getRepos() {
        return this.request(config.endpoints.repos);
    }
    // Tasks
    async getTasks(projectId) {
        return this.request(config.endpoints.tasks(projectId));
    }
    async getTask(taskId) {
        return this.request(config.endpoints.task(taskId));
    }
    // Workspaces (task-attempts)
    async getWorkspaces(taskId) {
        return this.request(config.endpoints.taskAttemptsByTask(taskId));
    }
    async getWorkspace(workspaceId) {
        return this.request(config.endpoints.taskAttempt(workspaceId));
    }
    async getAllWorkspaces() {
        return this.request(config.endpoints.taskAttempts);
    }
    async getWorkspaceSummary(workspaceIds) {
        try {
            const allSummaries = await this.request(config.endpoints.taskAttemptSummary, {
                method: 'POST',
                body: JSON.stringify({ workspace_ids: workspaceIds }),
            });
            return allSummaries.filter(s => workspaceIds.includes(s.workspace_id));
        }
        catch {
            const summaries = await Promise.all(workspaceIds.map(async (workspaceId) => {
                const sessions = await this.getSessions(workspaceId);
                if (sessions.length === 0) {
                    return null;
                }
                const processes = (await Promise.all(sessions.map(async (session) => {
                    const sessionProcesses = await this.getSessionProcesses(session.id);
                    return sessionProcesses.map(process => ({ ...process, session_id: session.id }));
                }))).flat();
                if (processes.length === 0) {
                    return null;
                }
                const latestProcess = processes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
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
            return summaries.filter((summary) => summary !== null);
        }
    }
    // Sessions
    async getSessions(workspaceId) {
        return this.request(config.endpoints.sessions(workspaceId));
    }
    async getSession(sessionId) {
        return this.request(config.endpoints.session(sessionId));
    }
    async createSession(body) {
        return this.request(config.endpoints.createSession, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }
    async updateSession(sessionId, body) {
        return this.request(config.endpoints.session(sessionId), {
            method: 'PUT',
            body: JSON.stringify(body),
        });
    }
    async sendMessage(sessionId, body) {
        return this.request(config.endpoints.sessionFollowUp(sessionId), {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }
    // Execution Processes
    async getExecutionProcess(processId) {
        return this.request(config.endpoints.executionProcess(processId));
    }
    async fetchConversation(processId, timeoutMs = 30 * 60 * 1000) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(config.wsEndpoints.executionLogs(processId));
            const doc = { entries: [] };
            let settled = false;
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                ws.terminate();
                resolve(doc.entries);
            };
            const applyPatch = (op) => {
                const pathParts = String(op.path ?? '').split('/').filter(Boolean);
                if (pathParts[0] !== 'entries')
                    return;
                if (pathParts.length === 1) {
                    if ((op.op === 'add' || op.op === 'replace') && Array.isArray(op.value)) {
                        doc.entries = op.value;
                    }
                    return;
                }
                if (pathParts.length === 2) {
                    const idx = Number.parseInt(pathParts[1], 10);
                    if (!Number.isInteger(idx))
                        return;
                    if (op.op === 'add') {
                        doc.entries.splice(idx, 0, op.value);
                    }
                    else if (op.op === 'replace') {
                        doc.entries[idx] = op.value;
                    }
                    else if (op.op === 'remove') {
                        doc.entries.splice(idx, 1);
                    }
                }
            };
            const timeout = setTimeout(() => {
                if (settled)
                    return;
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
                if (settled)
                    return;
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
    async findOrCreateSession(workspaceId, executor) {
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
