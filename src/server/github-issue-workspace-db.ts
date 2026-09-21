import { getExternalIntegrationsDb } from '../modules/plugins/kanban/server/database';
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

export class GithubIssueWorkspaceDbStore implements GithubIssueWorkspaceStore {
  async get(identity: GithubIssueIdentity): Promise<GithubIssueWorkspaceMapping | null> {
    const { db } = await getExternalIntegrationsDb();
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
    const { db } = await getExternalIntegrationsDb();
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
    const { db } = await getExternalIntegrationsDb();
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
