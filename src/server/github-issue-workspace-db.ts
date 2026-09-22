import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { getExternalIntegrationsDb } from '../modules/plugins/kanban/server/database';
import type { DB, GithubIssueWorkspaceReservationState } from '../store/kysely_types';
import {
  getRelatedWorkspacesForExternalIssues,
  upsertExternalIssueWorkspaceMapping,
} from '../modules/plugins/kanban/server/workspaceMappings';
import type {
  GithubIssueIdentity,
  GithubIssueWorkspaceMapping,
} from './github-issue-workspace-map';

export interface GithubIssueWorkspaceStore {
  get(identity: GithubIssueIdentity): Promise<GithubIssueWorkspaceMapping | null>;
  upsert(args: {
    identity: GithubIssueIdentity;
    workspaceId: string;
    branch: string;
  }): Promise<GithubIssueWorkspaceMapping>;
  delete(identity: GithubIssueIdentity): Promise<boolean>;
}

export interface GithubIssueWorkspaceReservationRequest {
  repoId: string;
  targetBranch: string;
  createBranch: boolean;
  checkoutBranch: string | null;
  name: string | null;
}

export interface GithubIssueWorkspaceReservation {
  state: GithubIssueWorkspaceReservationState;
  request: GithubIssueWorkspaceReservationRequest;
  workspaceId: string | null;
  branch: string | null;
  leaseToken: string | null;
  lastError: string | null;
}

export interface GithubIssueWorkspaceReservationClaim {
  acquired: boolean;
  reservation: GithubIssueWorkspaceReservation;
}

interface GithubIssueWorkspaceDbStoreOptions {
  getDb?: () => Promise<Kysely<DB>>;
  now?: () => Date;
  leaseMs?: number;
}

export class GithubIssueWorkspaceDbStore implements GithubIssueWorkspaceStore {
  private readonly getDb: () => Promise<Kysely<DB>>;
  private readonly now: () => Date;
  private readonly leaseMs: number;

  constructor(options: GithubIssueWorkspaceDbStoreOptions = {}) {
    this.getDb = options.getDb ?? (async () => (await getExternalIntegrationsDb()).db);
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 2 * 60 * 1000;
  }

  async get(identity: GithubIssueIdentity): Promise<GithubIssueWorkspaceMapping | null> {
    const db = await this.getDb();
    const externalIssue = toExternalIssue(identity);
    const related = await getRelatedWorkspacesForExternalIssues(db, [externalIssue]);
    const workspace = related.get(`github:github.com:${externalIssue.key}`)?.[0];
    if (!workspace) return null;
    const now = new Date().toISOString();
    return {
      ...identity,
      workspaceId: workspace.workspaceId,
      branch: typeof workspace.metadata?.branch === 'string' ? workspace.metadata.branch : '',
      createdAt: now,
      updatedAt: workspace.lastOpenedAt ?? now,
    };
  }

  async upsert(args: {
    identity: GithubIssueIdentity;
    workspaceId: string;
    branch: string;
  }): Promise<GithubIssueWorkspaceMapping> {
    const db = await this.getDb();
    const now = new Date().toISOString();
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: toExternalIssue(args.identity),
      workspace: {
        workspaceId: args.workspaceId,
        metadata: { branch: args.branch },
      },
      isPrimary: true,
      lastOpenedAt: now,
      metadata: { branch: args.branch },
    });
    return {
      ...args.identity,
      workspaceId: args.workspaceId,
      branch: args.branch,
      createdAt: now,
      updatedAt: now,
    };
  }

  async delete(identity: GithubIssueIdentity): Promise<boolean> {
    const db = await this.getDb();
    const issue = await db
      .selectFrom('ExternalIssue')
      .select('id')
      .where('provider', '=', 'github')
      .where('site', '=', 'github.com')
      .where('issueKey', '=', issueKey(identity))
      .executeTakeFirst();
    if (!issue) return false;
    const result = await db
      .deleteFrom('ExternalIssueWorkspaceLink')
      .where('externalIssueId', '=', issue.id)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async claimReservation(
    identity: GithubIssueIdentity,
    request: GithubIssueWorkspaceReservationRequest,
  ): Promise<GithubIssueWorkspaceReservationClaim> {
    const db = await this.getDb();
    const token = randomUUID();
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs).toISOString();
    const key = issueKey(identity);
    const requestJson = JSON.stringify(request);

    await db
      .insertInto('GithubIssueWorkspaceReservation')
      .values({
        id: randomUUID(),
        issueKey: key,
        owner: identity.owner.toLowerCase(),
        repo: identity.repo.toLowerCase(),
        issueNumber: identity.number,
        issueUrl: identity.normalizedIssueUrl,
        state: 'provisioning',
        requestJson,
        workspaceId: null,
        branch: null,
        leaseToken: token,
        leaseExpiresAt,
        lastError: null,
      })
      .onConflict((oc) => oc.column('issueKey').doNothing())
      .execute();

    let row = await this.getReservationRow(db, key);
    if (row.leaseToken === token) {
      return { acquired: true, reservation: parseReservation(row) };
    }
    if (row.state === 'ready') {
      return { acquired: false, reservation: parseReservation(row) };
    }

    const leaseExpired = !row.leaseExpiresAt || new Date(row.leaseExpiresAt).getTime() <= now.getTime();
    if (row.state === 'provisioning' && !leaseExpired) {
      return { acquired: false, reservation: parseReservation(row) };
    }

    let update = db
      .updateTable('GithubIssueWorkspaceReservation')
      .set({
        state: 'provisioning',
        requestJson: row.workspaceId ? row.requestJson : requestJson,
        leaseToken: token,
        leaseExpiresAt,
        lastError: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where('issueKey', '=', key)
      .where('state', '=', row.state);
    update = row.leaseToken
      ? update.where('leaseToken', '=', row.leaseToken)
      : update.where('leaseToken', 'is', null);
    const updated = await update.executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) {
      row = await this.getReservationRow(db, key);
      return { acquired: false, reservation: parseReservation(row) };
    }

    row = await this.getReservationRow(db, key);
    return { acquired: true, reservation: parseReservation(row) };
  }

  async recordWorkspace(
    identity: GithubIssueIdentity,
    leaseToken: string,
    workspaceId: string,
    branch: string,
  ): Promise<void> {
    await this.updateOwnedReservation(identity, leaseToken, {
      workspaceId,
      branch,
      state: 'provisioning',
    });
  }

  async renewReservationLease(
    identity: GithubIssueIdentity,
    leaseToken: string,
  ): Promise<void> {
    const leaseExpiresAt = new Date(this.now().getTime() + this.leaseMs).toISOString();
    await this.updateOwnedReservation(identity, leaseToken, { leaseExpiresAt });
  }

  async markReservationReady(identity: GithubIssueIdentity, leaseToken: string): Promise<void> {
    await this.updateOwnedReservation(identity, leaseToken, {
      state: 'ready',
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
    });
  }

  async markReservationRecoverable(
    identity: GithubIssueIdentity,
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const db = await this.getDb();
    const row = await this.getReservationRow(db, issueKey(identity));
    await this.updateOwnedReservation(identity, leaseToken, {
      state: row.workspaceId ? 'recoverable' : 'failed',
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  async markReadyWorkspaceMissing(identity: GithubIssueIdentity): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('GithubIssueWorkspaceReservation')
      .set({
        state: 'failed',
        workspaceId: null,
        branch: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: 'The reserved workspace no longer exists',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where('issueKey', '=', issueKey(identity))
      .where('state', '=', 'ready')
      .execute();
  }

  async markOwnedWorkspaceMissing(
    identity: GithubIssueIdentity,
    leaseToken: string,
  ): Promise<void> {
    await this.updateOwnedReservation(identity, leaseToken, {
      state: 'failed',
      workspaceId: null,
      branch: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: 'The reserved workspace no longer exists',
    });
  }

  private async getReservationRow(db: Kysely<DB>, key: string) {
    return db
      .selectFrom('GithubIssueWorkspaceReservation')
      .selectAll()
      .where('issueKey', '=', key)
      .executeTakeFirstOrThrow();
  }

  private async updateOwnedReservation(
    identity: GithubIssueIdentity,
    leaseToken: string,
    values: Partial<{
      state: GithubIssueWorkspaceReservationState;
      workspaceId: string | null;
      branch: string | null;
      leaseToken: string | null;
      leaseExpiresAt: string | null;
      lastError: string | null;
    }>,
  ): Promise<void> {
    const db = await this.getDb();
    const result = await db
      .updateTable('GithubIssueWorkspaceReservation')
      .set({ ...values, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where('issueKey', '=', issueKey(identity))
      .where('leaseToken', '=', leaseToken)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error(`GitHub issue workspace reservation lease was lost for ${issueKey(identity)}`);
    }
  }
}

function parseReservation(row: {
  state: GithubIssueWorkspaceReservationState;
  requestJson: string;
  workspaceId: string | null;
  branch: string | null;
  leaseToken: string | null;
  lastError: string | null;
}): GithubIssueWorkspaceReservation {
  return {
    state: row.state,
    request: JSON.parse(row.requestJson) as GithubIssueWorkspaceReservationRequest,
    workspaceId: row.workspaceId,
    branch: row.branch,
    leaseToken: row.leaseToken,
    lastError: row.lastError,
  };
}

function toExternalIssue(identity: GithubIssueIdentity) {
  return {
    provider: 'github' as const,
    key: issueKey(identity),
    id: String(identity.number),
    url: identity.normalizedIssueUrl,
    site: 'github.com',
  };
}

function issueKey(identity: GithubIssueIdentity): string {
  return `${identity.owner.toLowerCase()}/${identity.repo.toLowerCase()}#${identity.number}`;
}
