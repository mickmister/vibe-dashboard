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
    tasks: (projectId: string) => `${BASE_URL}/api/tasks?project_id=${projectId}`,
    createTask: `${BASE_URL}/api/tasks`,
    taskAttempts: (taskId: string) => `${BASE_URL}/api/task-attempts?task_id=${taskId}`,
    createTaskAttempt: `${BASE_URL}/api/task-attempts`,
    workspaces: `${BASE_URL}/api/workspaces`,
    workspace: (workspaceId: string) => `${BASE_URL}/api/workspaces/${workspaceId}`,
    startWorkspace: `${BASE_URL}/api/workspaces/start`,
    createWorkspaceFromPr: `${BASE_URL}/api/workspaces/from-pr`,
    projectRepos: (projectId: string) => `${BASE_URL}/api/projects/${projectId}/repositories`,
    repos: `${BASE_URL}/api/repos`,
    recentRepos: `${BASE_URL}/api/repos/recent`,
    repo: (repoId: string) => `${BASE_URL}/api/repos/${repoId}`,
    repoPrInfo: (url: string) => `${BASE_URL}/api/repos/pr-info?url=${encodeURIComponent(url)}`,
    repoPullRequests: (repoId: string, remoteName?: string) => `${BASE_URL}/api/repos/${repoId}/prs${remoteName ? `?remote=${encodeURIComponent(remoteName)}` : ''}`,
    repoRemotes: (repoId: string) => `${BASE_URL}/api/repos/${repoId}/remotes`,
    taskAttemptRepos: (workspaceId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/repos`,
    startDevServer: (workspaceId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/dev-server/start`,
    runConfigs: (workspaceId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/run-configs`,
    runConfig: (workspaceId: string, runConfigId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/run-configs/${runConfigId}`,
    startRunConfig: (workspaceId: string, runConfigId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/run-configs/${runConfigId}/start`,
    previewSlots: (workspaceId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/preview-slots`,
    previewSlot: (workspaceId: string, previewSlotId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/preview-slots/${previewSlotId}`,
    startPreviewSlot: (workspaceId: string, previewSlotId: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/preview-slots/${previewSlotId}/start`,
    previewSlotUrl: (workspaceId: string, previewSlotId: string, query: string) => `${BASE_URL}/api/workspaces/${workspaceId}/execution/preview-slots/${previewSlotId}/url${query ? `?${query}` : ''}`,
    executionProcess: (processId: string) => `${BASE_URL}/api/execution-processes/${processId}`,
    stopExecutionProcess: (processId: string) => `${BASE_URL}/api/execution-processes/${processId}/stop`,
    taskAttemptSummary: `${BASE_URL}/api/task-attempts/summary`,
    firstMessage: (workspaceId: string) => `${BASE_URL}/api/task-attempts/${workspaceId}/first-message`,
    sessions: (workspaceId: string) => `${BASE_URL}/api/sessions?workspace_id=${workspaceId}`,
    session: (sessionId: string) => `${BASE_URL}/api/sessions/${sessionId}`,
    createSession: `${BASE_URL}/api/sessions`,
    sessionFollowUp: (sessionId: string) => `${BASE_URL}/api/sessions/${sessionId}/follow-up`,
    sessionQueue: (sessionId: string) => `${BASE_URL}/api/sessions/${sessionId}/queue`,
    declarativeWorkflowRun: (workflowId: string) => `${BASE_URL}/dashboard/api/declarative-workflows/${encodeURIComponent(workflowId)}/run`,
    declarativeWorkflowRunOnce: (workflowId: string) => `${BASE_URL}/dashboard/api/declarative-workflows/${encodeURIComponent(workflowId)}/run-once`,
    declarativeWorkflowDefinitions: () => `${BASE_URL}/dashboard/api/declarative-workflow-definitions`,
    declarativeWorkflowDefinition: (workflowId: string) => `${BASE_URL}/dashboard/api/declarative-workflow-definitions/${encodeURIComponent(workflowId)}`,
    workflowInstanceStatus: (instanceId: string) => `${BASE_URL}/dashboard/api/workflow-instances/${encodeURIComponent(instanceId)}/status`,
  },

  // WebSocket endpoints
  wsEndpoints: {
    executionLogs: (processId: string) => `${WS_BASE_URL}/api/execution-processes/${processId}/normalized-logs/ws`,
    rawExecutionLogs: (processId: string) => `${WS_BASE_URL}/api/execution-processes/${processId}/raw-logs/ws`,
    sessionProcesses: (sessionId: string) => `${WS_BASE_URL}/api/execution-processes/stream/session/ws?session_id=${sessionId}`,
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
  } as const,

  // Codex variants
  variants: {
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
  } as const,
};

export type Executor = keyof typeof config.executors;
export type Variant = keyof typeof config.variants;
