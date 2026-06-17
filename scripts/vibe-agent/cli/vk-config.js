// Vibe Kanban API Configuration
const BASE_URL = process.env.VIBE_API_URL || process.env.VK_API_URL || 'http://localhost:3007';
const WS_BASE_URL = BASE_URL.replace('http', 'ws');
export const config = {
    BASE_URL,
    WS_BASE_URL,
    // API endpoints
    endpoints: {
        projects: `${BASE_URL}/api/projects`,
        createProject: `${BASE_URL}/api/projects`,
        tasks: (projectId) => `${BASE_URL}/api/tasks?project_id=${projectId}`,
        createTask: `${BASE_URL}/api/tasks`,
        taskAttempts: (taskId) => `${BASE_URL}/api/task-attempts?task_id=${taskId}`,
        createTaskAttempt: `${BASE_URL}/api/task-attempts`,
        workspaces: `${BASE_URL}/api/workspaces`,
        workspace: (workspaceId) => `${BASE_URL}/api/workspaces/${workspaceId}`,
        startWorkspace: `${BASE_URL}/api/workspaces/start`,
        createWorkspaceFromPr: `${BASE_URL}/api/workspaces/from-pr`,
        projectRepos: (projectId) => `${BASE_URL}/api/projects/${projectId}/repositories`,
        repos: `${BASE_URL}/api/repos`,
        recentRepos: `${BASE_URL}/api/repos/recent`,
        repo: (repoId) => `${BASE_URL}/api/repos/${repoId}`,
        repoPrInfo: (url) => `${BASE_URL}/api/repos/pr-info?url=${encodeURIComponent(url)}`,
        repoPullRequests: (repoId, remoteName) => `${BASE_URL}/api/repos/${repoId}/prs${remoteName ? `?remote=${encodeURIComponent(remoteName)}` : ''}`,
        repoRemotes: (repoId) => `${BASE_URL}/api/repos/${repoId}/remotes`,
        taskAttemptRepos: (workspaceId) => `${BASE_URL}/api/workspaces/${workspaceId}/repos`,
        startDevServer: (workspaceId) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/dev-server/start`,
        executionProcess: (processId) => `${BASE_URL}/api/execution-processes/${processId}`,
        stopExecutionProcess: (processId) => `${BASE_URL}/api/execution-processes/${processId}/stop`,
        taskAttemptSummary: `${BASE_URL}/api/task-attempts/summary`,
        firstMessage: (workspaceId) => `${BASE_URL}/api/task-attempts/${workspaceId}/first-message`,
        sessions: (workspaceId) => `${BASE_URL}/api/sessions?workspace_id=${workspaceId}`,
        session: (sessionId) => `${BASE_URL}/api/sessions/${sessionId}`,
        createSession: `${BASE_URL}/api/sessions`,
        sessionFollowUp: (sessionId) => `${BASE_URL}/api/sessions/${sessionId}/follow-up`,
    },
    // WebSocket endpoints
    wsEndpoints: {
        executionLogs: (processId) => `${WS_BASE_URL}/api/execution-processes/${processId}/normalized-logs/ws`,
        rawExecutionLogs: (processId) => `${WS_BASE_URL}/api/execution-processes/${processId}/raw-logs/ws`,
        sessionProcesses: (sessionId) => `${WS_BASE_URL}/api/execution-processes/stream/session/ws?session_id=${sessionId}`,
    },
    // Executor types
    executors: {
        CLAUDE_CODE: 'CLAUDE_CODE',
        CODEX: 'CODEX',
        GEMINI: 'GEMINI',
        AMP: 'AMP',
        CURSOR_AGENT: 'CURSOR_AGENT',
        COPILOT: 'COPILOT',
        DROID: 'DROID',
        OPENCODE: 'OPENCODE',
        QWEN_CODE: 'QWEN_CODE',
    },
    // Codex variants
    variants: {
        HIGH: 'HIGH',
        MEDIUM: 'MEDIUM',
        LOW: 'LOW',
    },
};
