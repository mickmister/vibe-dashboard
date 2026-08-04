import type {
  SessionThreadMapping,
  VkBridgeClient,
  VkNormalizedLogEvent,
  VkWorkspaceSummary,
} from './types';
import { buildVkWebSocketUrl, type VkQueryParams } from './vk-client';

type JsonPatchOperation = {
  op?: string;
  path?: string;
  value?: unknown;
};

type StreamEnvelope = {
  JsonPatch?: JsonPatchOperation[];
  finished?: unknown;
  [key: string]: unknown;
};

type SummaryListener = (snapshot: VkWorkspaceSummarySnapshot) => void;

export type VkWebSocketFactory = (url: string) => WebSocket;

export interface VkWorkspaceSummarySnapshot {
  archived: boolean;
  fetchedAt: string | null;
  summaries: VkWorkspaceSummary[];
  summariesByWorkspaceId: ReadonlyMap<string, VkWorkspaceSummary>;
}

export interface VkWorkspaceSummaryPollerOptions {
  vkClient: Pick<VkBridgeClient, 'listWorkspaceSummaries'>;
  archived: boolean;
  pollMs: number;
  runImmediately?: boolean;
  onUpdate?: SummaryListener;
  onError?: (error: unknown) => void;
}

export interface VkWorkspaceSummaryPoller {
  start(): void;
  stop(): void;
  refresh(): Promise<VkWorkspaceSummarySnapshot>;
  subscribe(listener: SummaryListener): () => void;
  getSnapshot(): VkWorkspaceSummarySnapshot;
  isRunning(): boolean;
}

export interface VkSessionWatchSelectionInput {
  workspaceSummaries:
    | Iterable<VkWorkspaceSummary>
    | ReadonlyMap<string, VkWorkspaceSummary>
    | Record<string, VkWorkspaceSummary>;
  linkedWorkspaceIds?: Iterable<string>;
  mappedSessionThreadMappings?: Iterable<
    Pick<SessionThreadMapping, 'workspaceId' | 'sessionId'>
  >;
  runningSessionIds?: Iterable<string>;
}

export interface VkSessionWatchSelection {
  sessionIds: string[];
  reasonsBySessionId: ReadonlyMap<string, ReadonlyArray<VkSessionWatchReason>>;
}

export type VkSessionWatchReason = 'mapped' | 'running' | 'latest';

export interface VkStreamWatcherOptions<TMessage = StreamEnvelope> {
  baseUrl: string;
  path: string;
  query?: VkQueryParams;
  createWebSocket?: VkWebSocketFactory;
  parseMessage?: (payload: unknown) => TMessage;
  onOpen?: () => void;
  onMessage?: (message: TMessage) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
  autoStart?: boolean;
}

export interface VkStreamWatcher {
  readonly url: string;
  connect(): void;
  close(): void;
  isConnected(): boolean;
}

export interface VkWorkspaceStreamWatcherOptions
  extends Omit<VkStreamWatcherOptions, 'path' | 'query'> {
  archived: boolean;
  limit?: number;
}

export interface VkSessionExecutionStreamWatcherOptions
  extends Omit<VkStreamWatcherOptions, 'path' | 'query'> {
  sessionId: string;
  showSoftDeleted?: boolean;
}

export interface VkNormalizedLogStreamWatcherOptions
  extends Omit<VkStreamWatcherOptions<StreamEnvelope>, 'path' | 'onMessage'> {
  executionId: string;
  onMessage?: (message: StreamEnvelope) => void;
  onLogEvent?: (event: VkNormalizedLogEvent) => void;
}

function emptySummarySnapshot(archived: boolean): VkWorkspaceSummarySnapshot {
  return {
    archived,
    fetchedAt: null,
    summaries: [],
    summariesByWorkspaceId: new Map(),
  };
}

function createSummarySnapshot(
  archived: boolean,
  summaries: VkWorkspaceSummary[]
): VkWorkspaceSummarySnapshot {
  return {
    archived,
    fetchedAt: new Date().toISOString(),
    summaries,
    summariesByWorkspaceId: new Map(
      summaries.map((summary) => [summary.workspaceId, summary])
    ),
  };
}

function normalizeWorkspaceSummaries(
  input: VkSessionWatchSelectionInput['workspaceSummaries']
): VkWorkspaceSummary[] {
  if (input instanceof Map) {
    return [...input.values()];
  }

  if (Symbol.iterator in Object(input)) {
    return [...(input as Iterable<VkWorkspaceSummary>)];
  }

  return Object.values(input);
}

function parseStreamEnvelope(payload: unknown): StreamEnvelope {
  if (!payload || typeof payload !== 'object') {
    throw new Error('VK stream message was not an object');
  }

  return payload as StreamEnvelope;
}

function createDefaultWebSocket(url: string): WebSocket {
  return new WebSocket(url);
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractChangedFiles(
  entry: unknown
): VkNormalizedLogEvent['changedFiles'] | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const content = (entry as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const entryType = (content as Record<string, unknown>).entry_type;
  if (!entryType || typeof entryType !== 'object') {
    return undefined;
  }

  if ((entryType as Record<string, unknown>).type !== 'tool_use') {
    return undefined;
  }

  const actionType = (entryType as Record<string, unknown>).action_type;
  if (!actionType || typeof actionType !== 'object') {
    return undefined;
  }

  const path = safeString((actionType as Record<string, unknown>).path);
  const changes = (actionType as Record<string, unknown>).changes;
  const stats = Array.isArray(changes)
    ? aggregateDiffStats(changes)
    : { linesAdded: null, linesRemoved: null };

  if (!path) {
    return undefined;
  }

  return [
    {
      path,
      linesAdded: stats.linesAdded,
      linesRemoved: stats.linesRemoved,
    },
  ];
}

function aggregateDiffStats(changes: unknown[]): {
  linesAdded: number | null;
  linesRemoved: number | null;
} {
  let linesAdded = 0;
  let linesRemoved = 0;
  let sawDiff = false;

  for (const change of changes) {
    if (!change || typeof change !== 'object') {
      continue;
    }

    const unifiedDiff = safeString(
      (change as Record<string, unknown>).unified_diff
    );
    if (!unifiedDiff) {
      continue;
    }

    sawDiff = true;
    const parsed = parseUnifiedDiffStats(unifiedDiff);
    linesAdded += parsed.linesAdded;
    linesRemoved += parsed.linesRemoved;
  }

  if (!sawDiff) {
    return {
      linesAdded: null,
      linesRemoved: null,
    };
  }

  return {
    linesAdded,
    linesRemoved,
  };
}

function parseUnifiedDiffStats(diff: string): {
  linesAdded: number;
  linesRemoved: number;
} {
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+')) {
      linesAdded += 1;
    } else if (line.startsWith('-')) {
      linesRemoved += 1;
    }
  }

  return {
    linesAdded,
    linesRemoved,
  };
}

function extractMessage(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const content = (entry as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') {
    return null;
  }

  const entryType = (content as Record<string, unknown>).entry_type;
  const body = safeString((content as Record<string, unknown>).content);

  if (!entryType || typeof entryType !== 'object') {
    return body;
  }

  const type = (entryType as Record<string, unknown>).type;
  return typeof type === 'string' ? body : null;
}

export function extractNormalizedLogEvents(
  executionId: string,
  envelope: StreamEnvelope
): VkNormalizedLogEvent[] {
  const operations = Array.isArray(envelope.JsonPatch) ? envelope.JsonPatch : [];
  const events: VkNormalizedLogEvent[] = [];

  for (const operation of operations) {
    const path = safeString(operation.path);
    const match = path?.match(/^\/entries\/(\d+)$/);
    if (!match) {
      continue;
    }

    const sequence = Number(match[1]);
    const rawEntry = operation.value;
    let timestamp = new Date().toISOString();

    if (rawEntry && typeof rawEntry === 'object') {
      const content = (rawEntry as Record<string, unknown>).content;
      if (content && typeof content === 'object') {
        timestamp =
          safeString((content as Record<string, unknown>).timestamp) ??
          timestamp;
      }
    }

    events.push({
      executionId,
      sequence,
      timestamp,
      message: extractMessage(rawEntry),
      isFinal: false,
      changedFiles: extractChangedFiles(rawEntry),
      raw: rawEntry,
    });
  }

  if (envelope.finished !== undefined && events.length > 0) {
    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      events[events.length - 1] = {
        ...lastEvent,
        isFinal: true,
      };
    }
  }

  return events;
}

export function createWorkspaceSummaryPoller(
  options: VkWorkspaceSummaryPollerOptions
): VkWorkspaceSummaryPoller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let snapshot = emptySummarySnapshot(options.archived);
  const listeners = new Set<SummaryListener>();

  const emit = () => {
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const schedule = () => {
    timer = setTimeout(async () => {
      timer = null;

      try {
        await refresh();
      } catch (error) {
        options.onError?.(error);
      } finally {
        if (timer === null) {
          schedule();
        }
      }
    }, options.pollMs);
  };

  const refresh = async (): Promise<VkWorkspaceSummarySnapshot> => {
    const summaries = await options.vkClient.listWorkspaceSummaries(
      options.archived
    );
    snapshot = createSummarySnapshot(options.archived, summaries);
    options.onUpdate?.(snapshot);
    emit();
    return snapshot;
  };

  return {
    start() {
      if (timer !== null) {
        return;
      }

      if (options.runImmediately !== false) {
        void refresh().catch((error) => {
          options.onError?.(error);
        });
      }

      schedule();
    },

    stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },

    refresh,

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return snapshot;
    },

    isRunning() {
      return timer !== null;
    },
  };
}

export function selectSessionIdsToWatch(
  input: VkSessionWatchSelectionInput
): VkSessionWatchSelection {
  const sessionIds = new Set<string>();
  const reasonsBySessionId = new Map<string, VkSessionWatchReason[]>();
  const summaries = normalizeWorkspaceSummaries(input.workspaceSummaries);
  const linkedWorkspaceIds = input.linkedWorkspaceIds
    ? new Set(input.linkedWorkspaceIds)
    : null;

  const add = (sessionId: string | null | undefined, reason: VkSessionWatchReason) => {
    if (!sessionId) {
      return;
    }

    sessionIds.add(sessionId);
    const existing = reasonsBySessionId.get(sessionId) ?? [];
    if (!existing.includes(reason)) {
      existing.push(reason);
      reasonsBySessionId.set(sessionId, existing);
    }
  };

  for (const mapping of input.mappedSessionThreadMappings ?? []) {
    add(mapping.sessionId, 'mapped');
  }

  for (const sessionId of input.runningSessionIds ?? []) {
    add(sessionId, 'running');
  }

  for (const summary of summaries) {
    if (
      linkedWorkspaceIds &&
      !linkedWorkspaceIds.has(summary.workspaceId)
    ) {
      continue;
    }

    add(summary.latestSessionId, 'latest');
  }

  return {
    sessionIds: [...sessionIds],
    reasonsBySessionId,
  };
}

export function createVkStreamWatcher<TMessage = StreamEnvelope>(
  options: VkStreamWatcherOptions<TMessage>
): VkStreamWatcher {
  const url = buildVkWebSocketUrl(options.baseUrl, options.path, options.query);
  const createWebSocket = options.createWebSocket ?? createDefaultWebSocket;
  const parseMessage = options.parseMessage ?? ((value: unknown) => value as TMessage);
  let socket: WebSocket | null = null;
  let connected = false;
  let closed = false;

  const connect = () => {
    if (closed || socket) {
      return;
    }

    socket = createWebSocket(url);

    socket.addEventListener('open', () => {
      connected = true;
      options.onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        options.onMessage?.(parseMessage(payload));
      } catch (error) {
        options.onError?.(error);
      }
    });

    socket.addEventListener('error', (event) => {
      options.onError?.(event);
    });

    socket.addEventListener('close', () => {
      connected = false;
      socket = null;
      options.onClose?.();
    });
  };

  if (options.autoStart !== false) {
    connect();
  }

  return {
    url,

    connect,

    close() {
      closed = true;
      connected = false;
      socket?.close();
      socket = null;
    },

    isConnected() {
      return connected;
    },
  };
}

export function createVkWorkspaceStreamWatcher(
  options: VkWorkspaceStreamWatcherOptions
): VkStreamWatcher {
  return createVkStreamWatcher({
    ...options,
    path: '/api/workspaces/streams/ws',
    query: {
      archived: options.archived,
      limit: options.limit,
    },
    parseMessage: parseStreamEnvelope,
  });
}

export function createVkSessionExecutionStreamWatcher(
  options: VkSessionExecutionStreamWatcherOptions
): VkStreamWatcher {
  return createVkStreamWatcher({
    ...options,
    path: '/api/execution-processes/stream/session/ws',
    query: {
      session_id: options.sessionId,
      show_soft_deleted: options.showSoftDeleted,
    },
    parseMessage: parseStreamEnvelope,
  });
}

export function createVkNormalizedLogStreamWatcher(
  options: VkNormalizedLogStreamWatcherOptions
): VkStreamWatcher {
  return createVkStreamWatcher({
    ...options,
    path: `/api/execution-processes/${options.executionId}/normalized-logs/ws`,
    parseMessage: parseStreamEnvelope,
    onMessage: (message) => {
      options.onMessage?.(message);
      for (const event of extractNormalizedLogEvents(
        options.executionId,
        message
      )) {
        options.onLogEvent?.(event);
      }
    },
  });
}
