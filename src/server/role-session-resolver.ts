import type { Kysely, Selectable } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { AgentTeam, TeamAgent } from '../teams/agentTeams';
import type { DB, WorkflowRoleSessionBinding, WorkflowRoleSessionBindingSource } from '../store/kysely_types';
import type { Executor, Session } from './vk-client';

export interface RoleSessionVkClient {
  getSessions(workspaceId: string): Promise<Session[]>;
  getSession(sessionId: string): Promise<Session>;
  createSession(body: { workspace_id: string; executor: Executor; name?: string | null }): Promise<Session>;
}

export interface RoleSessionOverride {
  sessionId: string;
  executor?: Executor | string | null;
}

export interface ResolveRoleSessionsInput {
  team: AgentTeam;
  workflowId?: string | null;
  instanceId?: string | null;
  laneId?: string | null;
  workspaceId: string;
  roleIds?: string[];
  overrides?: Record<string, RoleSessionOverride | string | null | undefined>;
  allowAutoCreate?: boolean;
  allowRoleNameReuse?: boolean;
}

export type RoleSessionResolutionStatus = 'resolved' | 'error';
export type RoleSessionResolutionSource = WorkflowRoleSessionBindingSource;

export interface RoleSessionResolutionResult {
  roleId: string;
  roleName: string;
  status: RoleSessionResolutionStatus;
  sessionId: string | null;
  workspaceId: string;
  laneId: string | null;
  executor: string | null;
  source: RoleSessionResolutionSource | null;
  bindingId: string | null;
  warnings: string[];
  error: string | null;
}

export interface ResolveRoleSessionsResult {
  ok: boolean;
  results: RoleSessionResolutionResult[];
  errors: RoleSessionResolutionResult[];
  warnings: string[];
}

interface ResolvedRoleSession {
  roleId: string;
  roleName: string;
  session: Session;
  source: RoleSessionResolutionSource;
  warnings: string[];
}

export class WorkflowRoleSessionResolver {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly vk: RoleSessionVkClient;
  private readonly now: () => number;
  private readonly createBindingId: () => string;

  constructor(options: {
    db?: Kysely<DB>;
    getDb?: () => Promise<Kysely<DB>> | Kysely<DB>;
    vk: RoleSessionVkClient;
    now?: () => number;
    createBindingId?: () => string;
  }) {
    if (!options.db && !options.getDb) throw new Error('WorkflowRoleSessionResolver requires db or getDb');
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
    this.vk = options.vk;
    this.now = options.now ?? Date.now;
    this.createBindingId = options.createBindingId ?? (() => `role_binding_${randomUUID()}`);
  }

  async resolve(input: ResolveRoleSessionsInput): Promise<ResolveRoleSessionsResult> {
    const roles = selectRequestedAgents(input.team, input.roleIds);
    const laneId = input.laneId ?? null;
    const allowAutoCreate = input.allowAutoCreate ?? true;
    const allowRoleNameReuse = input.allowRoleNameReuse ?? true;
    const errors: RoleSessionResolutionResult[] = [];
    const resolved: ResolvedRoleSession[] = [];
    const preResolved = new Map<string, ResolvedRoleSession>();
    let workspaceSessions: Session[] | null = null;

    for (const agent of roles) {
      const roleName = agent.role || agent.displayName || agent.id;
      const expectedExecutor = normalizeExecutor(agent.executor) ?? 'CODEX';
      const override = normalizeOverride(input.overrides?.[agent.id] ?? input.overrides?.[roleName]);
      if (!override) continue;
      try {
        preResolved.set(
          agent.id,
          await this.resolveOverride(agent, roleName, input.workspaceId, expectedExecutor, override),
        );
      } catch (error) {
        errors.push({
          roleId: agent.id,
          roleName,
          status: 'error',
          sessionId: null,
          workspaceId: input.workspaceId,
          laneId,
          executor: expectedExecutor,
          source: null,
          bindingId: null,
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (errors.length > 0) {
      return { ok: false, results: errors, errors, warnings: [] };
    }

    for (const agent of roles) {
      const roleName = agent.role || agent.displayName || agent.id;
      const expectedExecutor = normalizeExecutor(agent.executor) ?? 'CODEX';
      try {
        const resolution =
          preResolved.get(agent.id) ??
          (await this.resolveDefault({
            agent,
            roleName,
            expectedExecutor,
            workspaceId: input.workspaceId,
            laneId,
            allowAutoCreate,
            allowRoleNameReuse,
            getWorkspaceSessions: async () => {
              workspaceSessions ??= await this.vk.getSessions(input.workspaceId);
              return workspaceSessions;
            },
          }));
        resolved.push(resolution);
      } catch (error) {
        errors.push({
          roleId: agent.id,
          roleName,
          status: 'error',
          sessionId: null,
          workspaceId: input.workspaceId,
          laneId,
          executor: expectedExecutor,
          source: null,
          bindingId: null,
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (errors.length > 0) {
      return { ok: false, results: errors, errors, warnings: [] };
    }

    const persisted = await this.persistBindings(input, laneId, resolved);
    const results = persisted.map((binding, index) => {
      const resolution = resolved[index]!;
      return {
        roleId: resolution.roleId,
        roleName: resolution.roleName,
        status: 'resolved' as const,
        sessionId: resolution.session.id,
        workspaceId: resolution.session.workspace_id,
        laneId,
        executor: resolution.session.executor,
        source: resolution.source,
        bindingId: binding.bindingId,
        warnings: resolution.warnings,
        error: null,
      };
    });
    return {
      ok: true,
      results,
      errors: [],
      warnings: results.flatMap((result) => result.warnings),
    };
  }

  async listBindings(filters: { workspaceId?: string; laneId?: string | null; roleId?: string; teamId?: string; instanceId?: string; valid?: boolean } = {}): Promise<RoleSessionBindingReadModel[]> {
    const db = await this.getDb();
    let query = db.selectFrom('WorkflowRoleSessionBinding').selectAll();
    if (filters.workspaceId) query = query.where('workspaceId', '=', filters.workspaceId);
    if (filters.laneId !== undefined) query = filters.laneId === null ? query.where('laneId', 'is', null) : query.where('laneId', '=', filters.laneId);
    if (filters.roleId) query = query.where('roleId', '=', filters.roleId);
    if (filters.teamId) query = query.where('teamId', '=', filters.teamId);
    if (filters.instanceId) query = query.where('instanceId', '=', filters.instanceId);
    if (filters.valid !== undefined) query = query.where('valid', '=', filters.valid ? 1 : 0);
    const rows = await query.orderBy('updatedAt', 'desc').orderBy('bindingId', 'desc').execute();
    return rows.map(mapBinding);
  }

  private async resolveDefault(args: {
    agent: TeamAgent;
    roleName: string;
    expectedExecutor: Executor;
    workspaceId: string;
    laneId: string | null;
    allowAutoCreate: boolean;
    allowRoleNameReuse: boolean;
    getWorkspaceSessions: () => Promise<Session[]>;
  }): Promise<ResolvedRoleSession> {
    const binding = await this.findBinding(args.workspaceId, args.laneId, args.agent.id);
    if (binding) {
      const session = await this.getUsableSession(binding.sessionId, args.workspaceId, args.expectedExecutor, 'existing binding');
      if (session) return { roleId: args.agent.id, roleName: args.roleName, session, source: 'auto_reused', warnings: [] };
    }

    if (args.agent.vkSessionId) {
      const session = await this.getUsableSession(args.agent.vkSessionId, args.workspaceId, args.expectedExecutor, 'team config session');
      if (session) return { roleId: args.agent.id, roleName: args.roleName, session, source: 'team_config', warnings: [] };
    }

    if (args.allowRoleNameReuse) {
      const sessions = await args.getWorkspaceSessions();
      const matching = [...sessions]
        .filter((session) => session.name === args.roleName && session.executor === args.expectedExecutor)
        .sort((a, b) => parseTimestamp(b.updated_at || b.created_at) - parseTimestamp(a.updated_at || a.created_at))[0];
      if (matching) return { roleId: args.agent.id, roleName: args.roleName, session: matching, source: 'auto_reused', warnings: [] };
    }

    if (!args.allowAutoCreate) {
      throw new Error(`No reusable VK session found for role ${args.roleName} in workspace ${args.workspaceId}`);
    }

    const session = await this.vk.createSession({
      workspace_id: args.workspaceId,
      executor: args.expectedExecutor,
      name: args.roleName,
    });
    return { roleId: args.agent.id, roleName: args.roleName, session, source: 'auto_created', warnings: [] };
  }

  private async resolveOverride(agent: TeamAgent, roleName: string, workspaceId: string, expectedExecutor: Executor, override: RoleSessionOverride): Promise<ResolvedRoleSession> {
    const session = await this.vk.getSession(override.sessionId);
    if (session.workspace_id !== workspaceId) {
      throw new Error(`Override session ${session.id} belongs to workspace ${session.workspace_id}, expected ${workspaceId}`);
    }
    const warnings: string[] = [];
    if (session.executor !== expectedExecutor) {
      warnings.push(`Override session ${session.id} executor ${session.executor} differs from expected ${expectedExecutor} for role ${roleName}`);
    }
    if (override.executor && session.executor !== override.executor) {
      warnings.push(`Override requested executor ${override.executor} but session ${session.id} uses ${session.executor}`);
    }
    return { roleId: agent.id, roleName, session, source: 'user_selected', warnings };
  }

  private async getUsableSession(sessionId: string, workspaceId: string, expectedExecutor: Executor, label: string): Promise<Session | null> {
    try {
      const session = await this.vk.getSession(sessionId);
      if (session.workspace_id !== workspaceId) return null;
      if (session.executor !== expectedExecutor) return null;
      return session;
    } catch {
      await this.invalidateBinding(sessionId, label);
      return null;
    }
  }

  private async findBinding(workspaceId: string, laneId: string | null, roleId: string): Promise<RoleSessionBindingReadModel | null> {
    const db = await this.getDb();
    let query = db
      .selectFrom('WorkflowRoleSessionBinding')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('roleId', '=', roleId)
      .where('valid', '=', 1);
    query = laneId === null ? query.where('laneId', 'is', null) : query.where('laneId', '=', laneId);
    const row = await query.orderBy('updatedAt', 'desc').orderBy('bindingId', 'desc').executeTakeFirst();
    return row ? mapBinding(row) : null;
  }

  private async persistBindings(input: ResolveRoleSessionsInput, laneId: string | null, resolutions: ResolvedRoleSession[]): Promise<RoleSessionBindingReadModel[]> {
    const db = await this.getDb();
    const now = this.now();
    return db.transaction().execute(async (trx) => {
      const persisted: RoleSessionBindingReadModel[] = [];
      for (const resolution of resolutions) {
        await trx
          .updateTable('WorkflowRoleSessionBinding')
          .set({ valid: 0, updatedAt: now })
          .where('workspaceId', '=', resolution.session.workspace_id)
          .where('roleId', '=', resolution.roleId)
          .where('valid', '=', 1)
          .$if(laneId === null, (qb) => qb.where('laneId', 'is', null))
          .$if(laneId !== null, (qb) => qb.where('laneId', '=', laneId))
          .execute();

        const bindingId = this.createBindingId();
        await trx
          .insertInto('WorkflowRoleSessionBinding')
          .values({
            bindingId,
            teamId: input.team.id,
            workflowId: input.workflowId ?? null,
            instanceId: input.instanceId ?? null,
            laneId,
            roleId: resolution.roleId,
            roleName: resolution.roleName,
            workspaceId: resolution.session.workspace_id,
            sessionId: resolution.session.id,
            executor: resolution.session.executor,
            source: resolution.source,
            valid: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        const row = await trx.selectFrom('WorkflowRoleSessionBinding').selectAll().where('bindingId', '=', bindingId).executeTakeFirstOrThrow();
        persisted.push(mapBinding(row));
      }
      return persisted;
    });
  }

  private async invalidateBinding(sessionId: string, reason: string): Promise<void> {
    const db = await this.getDb();
    await db.updateTable('WorkflowRoleSessionBinding').set({ valid: 0, updatedAt: this.now() }).where('sessionId', '=', sessionId).execute();
    void reason;
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }
}

export interface RoleSessionBindingReadModel {
  bindingId: string;
  teamId: string | null;
  workflowId: string | null;
  instanceId: string | null;
  laneId: string | null;
  roleId: string;
  roleName: string;
  workspaceId: string;
  sessionId: string;
  executor: string | null;
  source: WorkflowRoleSessionBindingSource;
  valid: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

function selectRequestedAgents(team: AgentTeam, roleIds: string[] | undefined): TeamAgent[] {
  const enabledAgents = team.agents.filter((agent) => agent.enabled !== false);
  if (!roleIds || roleIds.length === 0) return enabledAgents;
  const agentsById = new Map(enabledAgents.map((agent) => [agent.id, agent]));
  return roleIds.map((roleId) => {
    const agent = agentsById.get(roleId);
    if (!agent) throw new Error(`Team role not found or disabled: ${roleId}`);
    return agent;
  });
}

function normalizeOverride(value: RoleSessionOverride | string | null | undefined): RoleSessionOverride | null {
  if (!value) return null;
  if (typeof value === 'string') return { sessionId: value };
  return value.sessionId ? value : null;
}

function normalizeExecutor(value: string | null | undefined): Executor | null {
  return isExecutor(value) ? value : null;
}

function isExecutor(value: unknown): value is Executor {
  return value === 'CLAUDE_CODE' || value === 'CODEX' || value === 'GEMINI' || value === 'AMP' || value === 'CURSOR_AGENT' || value === 'COPILOT' || value === 'DROID' || value === 'OPENCODE' || value === 'QWEN_CODE';
}

function mapBinding(row: Selectable<WorkflowRoleSessionBinding>): RoleSessionBindingReadModel {
  return {
    bindingId: row.bindingId,
    teamId: row.teamId,
    workflowId: row.workflowId,
    instanceId: row.instanceId,
    laneId: row.laneId,
    roleId: row.roleId,
    roleName: row.roleName,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    executor: row.executor,
    source: row.source,
    valid: row.valid === 1,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseTimestamp(value: string | null | undefined): number {
  const parsed = new Date(value ?? '').getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
