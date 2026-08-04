export type ChatProvider = 'mattermost';

export interface ChatSpaceRef {
  provider: ChatProvider;
  spaceId: string;
  spaceLabel: string | null;
}

export interface WorkspaceChatBinding extends ChatSpaceRef {
  workspaceId: string;
  channelId: string;
  channelName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionChatThreadBinding {
  sessionId: string;
  workspaceId: string;
  provider: ChatProvider;
  channelId: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionChatPostBinding {
  executionId: string;
  sessionId: string;
  provider: ChatProvider;
  channelId: string;
  messageId: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepoChatRoute extends ChatSpaceRef {
  id: number;
  repoId: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepoChatRouteUpsertInput extends ChatSpaceRef {
  id?: number;
  repoId: string;
  priority: number;
  enabled: boolean;
}

export interface ChatProviderStatus {
  provider: ChatProvider;
  enabled: boolean;
  configured: boolean;
  defaultSpaceId: string | null;
  defaultSpaceLabel: string | null;
}

export interface ChatSpaceOption extends ChatSpaceRef {}

export interface ChatRoutingOverview {
  providerStatuses: ChatProviderStatus[];
  availableSpaces: ChatSpaceOption[];
  repoRoutes: RepoChatRoute[];
  workspaceBindings: WorkspaceChatBinding[];
}

export interface ChatIntegrationStore {
  ensureSchema(): Promise<void>;
  getWorkspaceBinding(workspaceId: string): Promise<WorkspaceChatBinding | null>;
  getWorkspaceBindingByChannelId(
    provider: ChatProvider,
    channelId: string
  ): Promise<WorkspaceChatBinding | null>;
  listWorkspaceBindings(
    provider?: ChatProvider
  ): Promise<WorkspaceChatBinding[]>;
  upsertWorkspaceBinding(
    binding: Omit<WorkspaceChatBinding, 'createdAt' | 'updatedAt'>
  ): Promise<WorkspaceChatBinding>;
  getSessionThreadBinding(
    sessionId: string
  ): Promise<SessionChatThreadBinding | null>;
  getSessionThreadBindingByThreadId(
    provider: ChatProvider,
    threadId: string
  ): Promise<SessionChatThreadBinding | null>;
  listSessionThreadBindings(
    provider?: ChatProvider
  ): Promise<SessionChatThreadBinding[]>;
  upsertSessionThreadBinding(
    binding: Omit<SessionChatThreadBinding, 'createdAt' | 'updatedAt'>
  ): Promise<SessionChatThreadBinding>;
  getExecutionPostBinding(
    executionId: string
  ): Promise<ExecutionChatPostBinding | null>;
  upsertExecutionPostBinding(
    binding: Omit<ExecutionChatPostBinding, 'createdAt' | 'updatedAt'>
  ): Promise<ExecutionChatPostBinding>;
  listRepoChatRoutes(provider?: ChatProvider): Promise<RepoChatRoute[]>;
  upsertRepoChatRoute(input: RepoChatRouteUpsertInput): Promise<RepoChatRoute>;
  deleteRepoChatRoute(id: number): Promise<boolean>;
  getConnectorState<T>(key: string): Promise<T | null>;
  tryReserveConnectorState<T>(key: string, value: T): Promise<boolean>;
  deleteConnectorState(key: string): Promise<boolean>;
  setConnectorState<T>(key: string, value: T): Promise<void>;
}
