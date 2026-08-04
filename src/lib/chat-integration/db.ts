// @platform "node"
import * as fs from 'node:fs';
import * as path from 'node:path';

import Database from 'better-sqlite3';

import { loadChatIntegrationDbPath } from './config';
import type {
  ChatIntegrationStore,
  ChatProvider,
  ExecutionChatPostBinding,
  RepoChatRoute,
  RepoChatRouteUpsertInput,
  SessionChatThreadBinding,
  WorkspaceChatBinding,
} from './types';

interface ConnectorStateRow {
  key: string;
  valueJson: string;
}

export interface SqliteChatIntegrationStoreOptions {
  dbPath?: string;
  legacyMattermostSpaceId?: string;
  legacyMattermostSpaceLabel?: string | null;
}

export class SqliteChatIntegrationStore implements ChatIntegrationStore {
  private readonly db: Database;

  constructor(private readonly options: SqliteChatIntegrationStoreOptions = {}) {
    const dbPath = options.dbPath ?? loadChatIntegrationDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async ensureSchema(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_chat_bindings (
        workspace_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        space_id TEXT NOT NULL,
        space_label TEXT,
        channel_id TEXT NOT NULL,
        channel_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, channel_id)
      );

      CREATE INDEX IF NOT EXISTS workspace_chat_bindings_provider_space_idx
      ON workspace_chat_bindings (provider, space_id);

      CREATE TABLE IF NOT EXISTS session_chat_threads (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, thread_id)
      );

      CREATE INDEX IF NOT EXISTS session_chat_threads_workspace_id_idx
      ON session_chat_threads (workspace_id);

      CREATE INDEX IF NOT EXISTS session_chat_threads_channel_id_idx
      ON session_chat_threads (provider, channel_id);

      CREATE TABLE IF NOT EXISTS execution_chat_posts (
        execution_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS execution_chat_posts_session_id_idx
      ON execution_chat_posts (session_id);

      CREATE INDEX IF NOT EXISTS execution_chat_posts_channel_id_idx
      ON execution_chat_posts (provider, channel_id);

      CREATE TABLE IF NOT EXISTS repo_chat_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        space_id TEXT NOT NULL,
        space_label TEXT,
        priority INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS repo_chat_routes_repo_priority_idx
      ON repo_chat_routes (repo_id, priority ASC, id ASC);

      CREATE TABLE IF NOT EXISTS connector_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.migrateLegacyTables();
  }

  async getWorkspaceBinding(
    workspaceId: string
  ): Promise<WorkspaceChatBinding | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            workspace_id AS workspaceId,
            provider,
            space_id AS spaceId,
            space_label AS spaceLabel,
            channel_id AS channelId,
            channel_name AS channelName,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM workspace_chat_bindings
          WHERE workspace_id = ?
        `
      )
      .get(workspaceId);

    return toWorkspaceChatBinding(row);
  }

  async getWorkspaceBindingByChannelId(
    provider: ChatProvider,
    channelId: string
  ): Promise<WorkspaceChatBinding | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            workspace_id AS workspaceId,
            provider,
            space_id AS spaceId,
            space_label AS spaceLabel,
            channel_id AS channelId,
            channel_name AS channelName,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM workspace_chat_bindings
          WHERE provider = ? AND channel_id = ?
        `
      )
      .get(provider, channelId);

    return toWorkspaceChatBinding(row);
  }

  async listWorkspaceBindings(
    provider?: ChatProvider
  ): Promise<WorkspaceChatBinding[]> {
    const rows = (
      provider
        ? this.db
            .prepare(
              `
                SELECT
                  workspace_id AS workspaceId,
                  provider,
                  space_id AS spaceId,
                  space_label AS spaceLabel,
                  channel_id AS channelId,
                  channel_name AS channelName,
                  created_at AS createdAt,
                  updated_at AS updatedAt
                FROM workspace_chat_bindings
                WHERE provider = ?
                ORDER BY updated_at DESC, workspace_id ASC
              `
            )
            .all(provider)
        : this.db
            .prepare(
              `
                SELECT
                  workspace_id AS workspaceId,
                  provider,
                  space_id AS spaceId,
                  space_label AS spaceLabel,
                  channel_id AS channelId,
                  channel_name AS channelName,
                  created_at AS createdAt,
                  updated_at AS updatedAt
                FROM workspace_chat_bindings
                ORDER BY updated_at DESC, workspace_id ASC
              `
            )
            .all()
    ) as unknown[];

    return rows.map((row) => toWorkspaceChatBinding(row)!);
  }

  async upsertWorkspaceBinding(
    binding: Omit<WorkspaceChatBinding, 'createdAt' | 'updatedAt'>
  ): Promise<WorkspaceChatBinding> {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO workspace_chat_bindings (
            workspace_id,
            provider,
            space_id,
            space_label,
            channel_id,
            channel_name,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            provider = excluded.provider,
            space_id = excluded.space_id,
            space_label = excluded.space_label,
            channel_id = excluded.channel_id,
            channel_name = excluded.channel_name,
            updated_at = excluded.updated_at
        `
      )
      .run(
        binding.workspaceId,
        binding.provider,
        binding.spaceId,
        binding.spaceLabel ?? null,
        binding.channelId,
        binding.channelName ?? null,
        now,
        now
      );

    const saved = await this.getWorkspaceBinding(binding.workspaceId);
    if (!saved) {
      throw new Error(
        `Failed to read workspace chat binding for workspace ${binding.workspaceId}`
      );
    }

    return saved;
  }

  async getSessionThreadBinding(
    sessionId: string
  ): Promise<SessionChatThreadBinding | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            session_id AS sessionId,
            workspace_id AS workspaceId,
            provider,
            channel_id AS channelId,
            thread_id AS threadId,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM session_chat_threads
          WHERE session_id = ?
        `
      )
      .get(sessionId);

    return toSessionChatThreadBinding(row);
  }

  async getSessionThreadBindingByThreadId(
    provider: ChatProvider,
    threadId: string
  ): Promise<SessionChatThreadBinding | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            session_id AS sessionId,
            workspace_id AS workspaceId,
            provider,
            channel_id AS channelId,
            thread_id AS threadId,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM session_chat_threads
          WHERE provider = ? AND thread_id = ?
        `
      )
      .get(provider, threadId);

    return toSessionChatThreadBinding(row);
  }

  async listSessionThreadBindings(
    provider?: ChatProvider
  ): Promise<SessionChatThreadBinding[]> {
    const rows = (
      provider
        ? this.db
            .prepare(
              `
                SELECT
                  session_id AS sessionId,
                  workspace_id AS workspaceId,
                  provider,
                  channel_id AS channelId,
                  thread_id AS threadId,
                  created_at AS createdAt,
                  updated_at AS updatedAt
                FROM session_chat_threads
                WHERE provider = ?
                ORDER BY updated_at DESC, session_id ASC
              `
            )
            .all(provider)
        : this.db
            .prepare(
              `
                SELECT
                  session_id AS sessionId,
                  workspace_id AS workspaceId,
                  provider,
                  channel_id AS channelId,
                  thread_id AS threadId,
                  created_at AS createdAt,
                  updated_at AS updatedAt
                FROM session_chat_threads
                ORDER BY updated_at DESC, session_id ASC
              `
            )
            .all()
    ) as unknown[];

    return rows.map((row) => toSessionChatThreadBinding(row)!);
  }

  async upsertSessionThreadBinding(
    binding: Omit<SessionChatThreadBinding, 'createdAt' | 'updatedAt'>
  ): Promise<SessionChatThreadBinding> {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO session_chat_threads (
            session_id,
            workspace_id,
            provider,
            channel_id,
            thread_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            provider = excluded.provider,
            channel_id = excluded.channel_id,
            thread_id = excluded.thread_id,
            updated_at = excluded.updated_at
        `
      )
      .run(
        binding.sessionId,
        binding.workspaceId,
        binding.provider,
        binding.channelId,
        binding.threadId,
        now,
        now
      );

    const saved = await this.getSessionThreadBinding(binding.sessionId);
    if (!saved) {
      throw new Error(
        `Failed to read session chat thread binding for session ${binding.sessionId}`
      );
    }

    return saved;
  }

  async getExecutionPostBinding(
    executionId: string
  ): Promise<ExecutionChatPostBinding | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            execution_id AS executionId,
            session_id AS sessionId,
            provider,
            channel_id AS channelId,
            message_id AS messageId,
            idempotency_key AS idempotencyKey,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM execution_chat_posts
          WHERE execution_id = ?
        `
      )
      .get(executionId);

    return toExecutionChatPostBinding(row);
  }

  async upsertExecutionPostBinding(
    binding: Omit<ExecutionChatPostBinding, 'createdAt' | 'updatedAt'>
  ): Promise<ExecutionChatPostBinding> {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO execution_chat_posts (
            execution_id,
            session_id,
            provider,
            channel_id,
            message_id,
            idempotency_key,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(execution_id) DO UPDATE SET
            session_id = excluded.session_id,
            provider = excluded.provider,
            channel_id = excluded.channel_id,
            message_id = excluded.message_id,
            idempotency_key = excluded.idempotency_key,
            updated_at = excluded.updated_at
        `
      )
      .run(
        binding.executionId,
        binding.sessionId,
        binding.provider,
        binding.channelId,
        binding.messageId,
        binding.idempotencyKey,
        now,
        now
      );

    const saved = await this.getExecutionPostBinding(binding.executionId);
    if (!saved) {
      throw new Error(
        `Failed to read execution chat post binding for execution ${binding.executionId}`
      );
    }

    return saved;
  }

  async listRepoChatRoutes(provider?: ChatProvider): Promise<RepoChatRoute[]> {
    const rows = (
      provider
        ? this.db
            .prepare(
              `
                SELECT
                  id,
                  repo_id AS repoId,
                  provider,
                  space_id AS spaceId,
                  space_label AS spaceLabel,
                  priority,
                  enabled,
                  created_at AS createdAt,
                  updated_at AS updatedAt
                FROM repo_chat_routes
                WHERE provider = ?
                ORDER BY priority ASC, id ASC
              `
            )
            .all(provider)
        : this.db
            .prepare(
              `
                SELECT
                  id,
                  repo_id AS repoId,
                  provider,
                  space_id AS spaceId,
                  space_label AS spaceLabel,
                  priority,
                  enabled,
                  created_at AS createdAt,
                  updated_at AS updatedAt
                FROM repo_chat_routes
                ORDER BY provider ASC, priority ASC, id ASC
              `
            )
            .all()
    ) as unknown[];

    return rows.map((row) => toRepoChatRoute(row)!);
  }

  async upsertRepoChatRoute(
    input: RepoChatRouteUpsertInput
  ): Promise<RepoChatRoute> {
    const now = new Date().toISOString();

    if (typeof input.id === 'number') {
      this.db
        .prepare(
          `
            UPDATE repo_chat_routes
            SET
              repo_id = ?,
              provider = ?,
              space_id = ?,
              space_label = ?,
              priority = ?,
              enabled = ?,
              updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          input.repoId,
          input.provider,
          input.spaceId,
          input.spaceLabel ?? null,
          input.priority,
          input.enabled ? 1 : 0,
          now,
          input.id
        );

      const saved = this.getRepoChatRouteRow(input.id);
      if (!saved) {
        throw new Error(`Failed to update repo chat route ${input.id}`);
      }
      return saved;
    }

    const result = this.db
      .prepare(
        `
          INSERT INTO repo_chat_routes (
            repo_id,
            provider,
            space_id,
            space_label,
            priority,
            enabled,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.repoId,
        input.provider,
        input.spaceId,
        input.spaceLabel ?? null,
        input.priority,
        input.enabled ? 1 : 0,
        now,
        now
      ) as { lastInsertRowid: number | bigint };

    return this.getRepoChatRouteRow(Number(result.lastInsertRowid))!;
  }

  async deleteRepoChatRoute(id: number): Promise<boolean> {
    const result = this.db
      .prepare(
        `
          DELETE FROM repo_chat_routes
          WHERE id = ?
        `
      )
      .run(id) as { changes: number };

    return result.changes > 0;
  }

  async getConnectorState<T>(key: string): Promise<T | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            key,
            value_json AS valueJson
          FROM connector_state
          WHERE key = ?
        `
      )
      .get(key) as ConnectorStateRow | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.valueJson) as T;
  }

  async tryReserveConnectorState<T>(key: string, value: T): Promise<boolean> {
    const now = new Date().toISOString();
    const valueJson = JSON.stringify(value);

    const result = this.db
      .prepare(
        `
          INSERT OR IGNORE INTO connector_state (
            key,
            value_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?)
        `
      )
      .run(key, valueJson, now, now) as { changes: number };

    return result.changes > 0;
  }

  async deleteConnectorState(key: string): Promise<boolean> {
    const result = this.db
      .prepare(
        `
          DELETE FROM connector_state
          WHERE key = ?
        `
      )
      .run(key) as { changes: number };

    return result.changes > 0;
  }

  async setConnectorState<T>(key: string, value: T): Promise<void> {
    const now = new Date().toISOString();
    const valueJson = JSON.stringify(value);

    this.db
      .prepare(
        `
          INSERT INTO connector_state (
            key,
            value_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      )
      .run(key, valueJson, now, now);
  }

  close(): void {
    this.db.close();
  }

  private getRepoChatRouteRow(id: number): RepoChatRoute | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            repo_id AS repoId,
            provider,
            space_id AS spaceId,
            space_label AS spaceLabel,
            priority,
            enabled,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM repo_chat_routes
          WHERE id = ?
        `
      )
      .get(id);

    return toRepoChatRoute(row);
  }

  private migrateLegacyTables(): void {
    const legacySpaceId = this.options.legacyMattermostSpaceId ?? '';
    const legacySpaceLabel = this.options.legacyMattermostSpaceLabel ?? null;

    if (this.hasTable('workspace_channels')) {
      this.db.exec(`
        INSERT OR IGNORE INTO workspace_chat_bindings (
          workspace_id,
          provider,
          space_id,
          space_label,
          channel_id,
          channel_name,
          created_at,
          updated_at
        )
        SELECT
          workspace_id,
          'mattermost',
          ${sqlStringLiteral(legacySpaceId)},
          ${sqlStringLiteral(legacySpaceLabel)},
          channel_id,
          channel_name,
          created_at,
          updated_at
        FROM workspace_channels
      `);
    }

    if (this.hasTable('session_threads')) {
      this.db.exec(`
        INSERT OR IGNORE INTO session_chat_threads (
          session_id,
          workspace_id,
          provider,
          channel_id,
          thread_id,
          created_at,
          updated_at
        )
        SELECT
          session_id,
          workspace_id,
          'mattermost',
          channel_id,
          root_post_id,
          created_at,
          updated_at
        FROM session_threads
      `);
    }

    if (this.hasTable('execution_posts')) {
      this.db.exec(`
        INSERT OR IGNORE INTO execution_chat_posts (
          execution_id,
          session_id,
          provider,
          channel_id,
          message_id,
          idempotency_key,
          created_at,
          updated_at
        )
        SELECT
          execution_id,
          session_id,
          'mattermost',
          channel_id,
          post_id,
          idempotency_key,
          created_at,
          updated_at
        FROM execution_posts
      `);
    }
  }

  private hasTable(tableName: string): boolean {
    const row = this.db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = ?
        `
      )
      .get(tableName);

    return Boolean(row);
  }
}

export function createChatIntegrationStore(
  options: SqliteChatIntegrationStoreOptions = {}
): ChatIntegrationStore {
  return new SqliteChatIntegrationStore(options);
}

function toWorkspaceChatBinding(row: unknown): WorkspaceChatBinding | null {
  if (!row) {
    return null;
  }

  return row as WorkspaceChatBinding;
}

function toSessionChatThreadBinding(
  row: unknown
): SessionChatThreadBinding | null {
  if (!row) {
    return null;
  }

  return row as SessionChatThreadBinding;
}

function toExecutionChatPostBinding(
  row: unknown
): ExecutionChatPostBinding | null {
  if (!row) {
    return null;
  }

  return row as ExecutionChatPostBinding;
}

function toRepoChatRoute(row: unknown): RepoChatRoute | null {
  if (!row) {
    return null;
  }

  const route = row as RepoChatRoute & { enabled: number | boolean };
  return {
    ...route,
    enabled: Boolean(route.enabled),
  };
}

function sqlStringLiteral(value: string | null): string {
  if (value === null) {
    return 'NULL';
  }

  return `'${value.replace(/'/g, "''")}'`;
}
// @platform end
