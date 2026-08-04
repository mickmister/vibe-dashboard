import type {
  ChatIntegrationStore,
  ExecutionChatPostBinding,
  SessionChatThreadBinding,
  WorkspaceChatBinding,
} from "../chat-integration/types";

export type JsonObject = Record<string, unknown>;

export type VkExecutionStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed"
  | null;

export interface VkExecutorConfig {
  executor: string;
  variant?: string | null;
  modelId?: string | null;
  agentId?: string | null;
  reasoningId?: string | null;
  permissionPolicy?: string | null;
}

export interface VkRepoSelection {
  repoId: string;
  targetBranch: string;
}

export interface VkRemoteIssue {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
}

export interface VkWorkspace {
  id: string;
  taskId: string;
  containerRef: string | null;
  name: string | null;
  archived: boolean;
  pinned: boolean;
}

export interface VkWorkspaceSummary {
  workspaceId: string;
  latestSessionId: string | null;
  hasPendingApproval: boolean;
  hasRunningDevServer: boolean;
  hasUnseenTurns: boolean;
  latestProcessStatus: VkExecutionStatus;
  latestProcessCompletedAt?: string;
  filesChanged: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  prStatus: "open" | "merged" | "closed" | "unknown" | null;
  prNumber?: string | null;
  prUrl?: string | null;
}

export interface VkSession {
  id: string;
  workspaceId: string;
  name: string | null;
}

export interface VkWorkspaceRepo {
  id: string;
  name: string;
  displayName: string | null;
  targetBranch: string | null;
}

export interface VkExecutionProcess {
  id: string;
  sessionId: string;
  status: VkExecutionStatus;
  createdAt?: string;
  updatedAt?: string;
}

export type VkWebhookEventType =
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.cancelled'
  | 'execution.halted'
  | 'approval.requested'
  | 'question.requested';

export interface VkWebhookEvent {
  eventType: VkWebhookEventType;
  deliveryId: string;
  occurredAt: string;
  title: string;
  message: string;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  executionId: string | null;
  exitCode: number | null;
}

export interface VkFollowUpRequest {
  message: string;
  executorConfig: VkExecutorConfig;
}

export interface VkNormalizedLogEvent {
  executionId: string;
  sequence: number;
  timestamp: string;
  message: string | null;
  isFinal: boolean;
  changedFiles?: Array<{
    path: string;
    linesAdded: number | null;
    linesRemoved: number | null;
  }>;
  raw: unknown;
}

export interface VkBridgeClient {
  createRemoteIssue(input: {
    title: string;
    description: string;
    projectId: string;
    statusId: string;
  }): Promise<VkRemoteIssue>;
  startWorkspace(input: {
    name: string | null;
    prompt: string;
    repos: VkRepoSelection[];
    linkedIssue: {
      issueId: string;
      remoteProjectId: string;
    } | null;
    executorConfig: VkExecutorConfig;
  }): Promise<{
    workspace: VkWorkspace;
    executionProcess: VkExecutionProcess;
  }>;
  listWorkspaces(): Promise<VkWorkspace[]>;
  listWorkspaceRepos(workspaceId: string): Promise<VkWorkspaceRepo[]>;
  listWorkspaceSummaries(archived: boolean): Promise<VkWorkspaceSummary[]>;
  listSessions(workspaceId: string): Promise<VkSession[]>;
  followUp(
    sessionId: string,
    input: VkFollowUpRequest,
  ): Promise<VkExecutionProcess>;
  queueFollowUp(
    sessionId: string,
    input: VkFollowUpRequest,
  ): Promise<{ status: "empty" | "queued" }>;
  markWorkspaceSeen(workspaceId: string): Promise<void>;
}

export type WorkspaceChannelMapping = WorkspaceChatBinding;
export type SessionThreadMapping = SessionChatThreadBinding;
export type ExecutionPostMapping = ExecutionChatPostBinding;

export interface MattermostPostRef {
  channelId: string;
  postId: string;
  rootId: string | null;
}

export interface MattermostPostEvent {
  postId: string;
  channelId: string;
  rootId: string | null;
  userId: string;
  message: string;
  props: JsonObject;
  createAt: number;
  isBotPost: boolean;
}

export interface MattermostSlashCommandRequest {
  channelId: string;
  channelName: string;
  teamId: string;
  teamDomain: string;
  token?: string;
  userId: string;
  userName: string;
  triggerId?: string;
  text: string;
  command: string;
  responseUrl?: string;
}

export interface MattermostSlashCommandResponse {
  responseType?: "ephemeral" | "in_channel";
  text: string;
}

export interface MattermostTeamSummary {
  id: string;
  name: string;
  displayName: string;
}

export interface MattermostBridgeClient {
  createTeam(input: {
    name: string;
    displayName: string;
  }): Promise<MattermostTeamSummary>;
  createChannel(input: {
    teamId: string;
    name: string;
    displayName: string;
    purpose?: string;
  }): Promise<{ id: string; name: string }>;
  listTeams(): Promise<MattermostTeamSummary[]>;
  listChannelPostsSince(
    channelId: string,
    sinceMs: number,
  ): Promise<MattermostPostEvent[]>;
  createPost(input: {
    channelId: string;
    message: string;
    rootId?: string | null;
    props?: JsonObject;
  }): Promise<MattermostPostRef>;
  createEphemeralPost(input: {
    userId: string;
    channelId: string;
    message: string;
    rootId?: string | null;
    props?: JsonObject;
  }): Promise<void>;
  createTypingSession(input: {
    channelId: string;
    parentId?: string | null;
  }): Promise<{ stop(): void }>;
}

export type MattermostBridgeStore = ChatIntegrationStore;

export interface MattermostPostTransportHealth {
  websocketEnabled: boolean;
  websocketUrl: string | null;
  websocketConnected: boolean;
  websocketAuthenticated: boolean;
  websocketReconnectAttempt: number;
  websocketReconnectScheduled: boolean;
  websocketReconnectMinMs: number;
  websocketReconnectMaxMs: number;
  reconnectBackfillDelayMs: number;
  reconciliationPollMs: number;
  lastWebsocketConnectAt: string | null;
  lastWebsocketDisconnectAt: string | null;
  lastWebsocketEventAt: string | null;
  lastReconciliationAt: string | null;
  lastReconciliationReason: string | null;
  lastReconciliationError: string | null;
}

export interface MattermostIntegrationConfig {
  enabled: boolean;
  publicBaseUrl: string;
  slashCommandPath: string;
  workspaceSummaryPollMs: number;
  vk: {
    baseUrl: string;
    apiKey?: string;
    defaultProjectId: string;
    defaultIssueStatusId: string;
    defaultRepoId: string;
    defaultRepoBranch: string;
    defaultExecutor: string;
    defaultExecutorVariant?: string | null;
    webhookSecret?: string | null;
    webhookPath: string;
  };
  mattermost: {
    baseUrl: string;
    userBaseUrl: string;
    botToken: string;
    teamId?: string | null;
    channelPrefix: string;
    botUserId?: string;
    slashCommandToken?: string;
    websocketEnabled: boolean;
    postReconciliationPollMs: number;
    postReconnectBackfillDelayMs: number;
    websocketReconnectMinMs: number;
    websocketReconnectMaxMs: number;
  };
}

export interface MattermostCoordinator {
  ensureStarted(): Promise<void>;
  observeWorkspaceSummaries(summaries: VkWorkspaceSummary[]): void;
  handleSlashCommand(
    payload: MattermostSlashCommandRequest,
  ): Promise<MattermostSlashCommandResponse>;
  handlePost(event: MattermostPostEvent): Promise<void>;
  handleVkWebhook(
    event: VkWebhookEvent,
  ): Promise<{ duplicate: boolean; posted: boolean }>;
  getHealth(): Promise<JsonObject>;
}

export interface MattermostCoordinatorDeps {
  config: MattermostIntegrationConfig;
  store: MattermostBridgeStore;
  vkClient: VkBridgeClient;
  mattermostClient: MattermostBridgeClient;
  logger?: Pick<Console, "info" | "warn" | "error">;
}
