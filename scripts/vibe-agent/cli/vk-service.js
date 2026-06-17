// Vibe Kanban Service Layer - API interactions for PM operations
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
import { config } from './vk-config.js';
// Service class
export class VKService {
    getPromptFromProcess(process) {
        return process.executor_action?.typ?.prompt || null;
    }
    async buildWorkspaceSummary(workspaceId) {
        const sessions = await this.listSessions(workspaceId);
        if (sessions.length === 0) {
            return null;
        }
        const processes = (await Promise.all(sessions.map(async (session) => {
            const sessionProcesses = await this.getSessionProcesses(session.id);
            return sessionProcesses.map(process => ({ ...process, session_id: session.id }));
        }))).flat();
        if (processes.length === 0) {
            return {
                workspace_id: workspaceId,
                latest_session_id: sessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]?.id ?? null,
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
    }
    async parseApiResponse(response, action) {
        const text = await response.text();
        const contentType = response.headers.get('content-type') || '';
        const looksJson = contentType.includes('application/json') || text.trim().startsWith('{');
        if (!response.ok) {
            throw new Error(`Failed to ${action}: ${text.trim() || `HTTP ${response.status}`}`);
        }
        if (!looksJson) {
            throw new Error(`Failed to ${action}: expected JSON response, got: ${text.trim() || '<empty body>'}`);
        }
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (err) {
            throw new Error(`Failed to ${action}: invalid JSON response: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!data.success) {
            const detail = data.message ?? JSON.stringify(data.error_data) ?? 'Unknown error';
            throw new Error(`Failed to ${action}: ${detail}`);
        }
        return data.data;
    }
    // Repositories
    async listRepos(options) {
        const response = await fetch(options?.recent ? config.endpoints.recentRepos : config.endpoints.repos);
        return this.parseApiResponse(response, 'fetch repos');
    }
    async getRepo(repoId) {
        const response = await fetch(config.endpoints.repo(repoId));
        return this.parseApiResponse(response, 'fetch repo');
    }
    async updateRepo(repoId, payload) {
        const response = await fetch(config.endpoints.repo(repoId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return this.parseApiResponse(response, 'update repo');
    }
    async setDevServerScript(repoId, script) {
        return this.updateRepo(repoId, { dev_server_script: script });
    }
    async getWorkspaceRepos(workspaceId) {
        const response = await fetch(config.endpoints.taskAttemptRepos(workspaceId));
        return this.parseApiResponse(response, 'fetch workspace repos');
    }
    async listRepoRemotes(repoId) {
        const response = await fetch(config.endpoints.repoRemotes(repoId));
        return this.parseApiResponse(response, 'fetch repo remotes');
    }
    async listOpenPrs(repoId, remoteName) {
        const response = await fetch(config.endpoints.repoPullRequests(repoId, remoteName));
        return this.parseApiResponse(response, 'fetch open pull requests');
    }
    async getPrInfo(prUrl) {
        const response = await fetch(config.endpoints.repoPrInfo(prUrl));
        return this.parseApiResponse(response, 'fetch pull request info');
    }
    // Workspaces
    async getWorkspace(workspaceId) {
        const response = await fetch(config.endpoints.workspace(workspaceId));
        return this.parseApiResponse(response, 'fetch workspace');
    }
    async getWorkspaces(taskId) {
        const response = await fetch(config.endpoints.taskAttempts(taskId));
        return this.parseApiResponse(response, 'fetch workspaces');
    }
    async createWorkspaceFromPr(body) {
        const response = await fetch(config.endpoints.createWorkspaceFromPr, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return this.parseApiResponse(response, 'create workspace from PR');
    }
    async startWorkspace(body) {
        const response = await fetch(config.endpoints.startWorkspace, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await this.parseApiResponse(response, 'start workspace');
        if ('workspace' in data) {
            return data;
        }
        return { workspace: data };
    }
    async getWorkspaceSummaries(workspaceIds) {
        try {
            const response = await fetch(config.endpoints.taskAttemptSummary, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspace_ids: workspaceIds,
                    archived: false,
                }),
            });
            const data = await this.parseApiResponse(response, 'fetch workspace summaries');
            return data.summaries.filter(s => workspaceIds.includes(s.workspace_id));
        }
        catch {
            const summaries = await Promise.all(workspaceIds.map(id => this.buildWorkspaceSummary(id)));
            return summaries.filter((summary) => summary !== null);
        }
    }
    // Sessions
    async listSessions(workspaceId) {
        const response = await fetch(config.endpoints.sessions(workspaceId));
        return this.parseApiResponse(response, 'fetch sessions');
    }
    async getSession(sessionId) {
        const response = await fetch(config.endpoints.session(sessionId));
        return this.parseApiResponse(response, 'fetch session');
    }
    async createSession(workspaceId, executor) {
        const response = await fetch(config.endpoints.createSession, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspace_id: workspaceId,
                executor: executor,
            }),
        });
        return this.parseApiResponse(response, 'create session');
    }
    async sendMessage(sessionId, prompt) {
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
                    executor: session.executor,
                },
                retry_process_id: null,
                force_when_dirty: null,
                perform_git_reset: null,
            }),
        });
        return this.parseApiResponse(response, 'send message');
    }
    // Dev servers
    async startDevServer(workspaceId) {
        const response = await fetch(config.endpoints.startDevServer(workspaceId), { method: 'POST' });
        return this.parseApiResponse(response, 'start dev server');
    }
    async getExecutionProcess(processId) {
        const response = await fetch(config.endpoints.executionProcess(processId));
        return this.parseApiResponse(response, 'fetch execution process');
    }
    async stopExecutionProcess(processId) {
        const response = await fetch(config.endpoints.stopExecutionProcess(processId), { method: 'POST' });
        return this.parseApiResponse(response, 'stop execution process');
    }
    async listRunningDevServers(workspaceId) {
        const sessions = await this.listSessions(workspaceId);
        const processes = (await Promise.all(sessions.map(async (session) => {
            const sessionProcesses = await this.getSessionProcesses(session.id);
            return sessionProcesses.map(process => ({ ...process, session_id: process.session_id || session.id }));
        }))).flat();
        return processes
            .filter(process => process.run_reason === 'devserver' && process.status === 'running')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    async fetchRawLogs(processId, timeoutMs = 2000) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(config.wsEndpoints.rawExecutionLogs(processId));
            const logs = [];
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
    async getSessionProcesses(sessionId) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(config.wsEndpoints.sessionProcesses(sessionId));
            const processesById = new Map();
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.JsonPatch) {
                    for (const op of msg.JsonPatch) {
                        // Handle replace on /execution_processes with map structure
                        if (op.path === '/execution_processes' && op.value) {
                            for (const proc of Object.values(op.value)) {
                                const process = proc;
                                processesById.set(process.id, process);
                            }
                        }
                        // Handle individual adds
                        if ((op.op === 'add' || op.op === 'replace') && op.value && op.path !== '/execution_processes') {
                            const process = op.value;
                            processesById.set(process.id, process);
                        }
                        if (op.op === 'remove' && op.path.startsWith('/execution_processes/')) {
                            processesById.delete(op.path.split('/').pop());
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
    async fetchConversation(processId, options) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(config.wsEndpoints.executionLogs(processId));
            const doc = { entries: [] };
            const applyPatch = (doc, op) => {
                const pathParts = op.path.split('/').filter((p) => p);
                if (pathParts[0] === 'entries') {
                    if (pathParts.length === 1) {
                        // /entries - the initial array
                        if (op.op === 'add' || op.op === 'replace') {
                            doc.entries = op.value;
                        }
                    }
                    else if (pathParts.length === 2) {
                        // /entries/N - add or replace an entry
                        const idx = parseInt(pathParts[1], 10);
                        if (op.op === 'add') {
                            doc.entries.splice(idx, 0, op.value);
                        }
                        else if (op.op === 'replace') {
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
    async getSessionSummary(workspaceId) {
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
            let latestUserMessage = this.getPromptFromProcess(latestProcess);
            let latestAgentMessage = null;
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
        summaries.sort((a, b) => new Date(b.session.updated_at).getTime() - new Date(a.session.updated_at).getTime());
        return summaries;
    }
}
