import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../../store/kysely_types';
import type { ExternalKanbanBoardViewDto } from '../boardTypes';
import { migrateExternalIntegrationsDb } from './migrate';
import { decorateExternalKanbanBoardWithWorkspaceMappings, getRelatedWorkspacesForExternalIssues, upsertExternalIssueWorkspaceMapping } from './workspaceMappings';

let sqlite: Database.Database;
let db: Kysely<DB>;
let executedSql: string[];

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  executedSql = [];
  db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqlite }),
    log(event) {
      if (event.level === 'query') executedSql.push(event.query.sql);
    },
  });
  await migrateExternalIntegrationsDb(db);
});

afterEach(async () => {
  await db.destroy();
  sqlite.close();
});

const boardView: ExternalKanbanBoardViewDto<'jira'> = {
  provider: 'jira',
  sourceUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42',
  siteHostname: 'team.atlassian.net',
  resource: { id: 'cloud-1', name: 'Team', url: 'https://team.atlassian.net' },
  board: { id: '42', name: 'VD Board', type: 'kanban', projectKey: 'VD' },
  columns: [{ id: 'todo-10000', title: 'To Do', statusIds: ['10000'] }],
  cards: [
    { id: '10001', key: 'VD-1', title: 'Mapped issue', url: 'https://team.atlassian.net/browse/VD-1', columnId: 'todo-10000', labels: [], rank: 0, metadata: {} },
    { id: '10002', key: 'VD-2', title: 'Unmapped issue', url: 'https://team.atlassian.net/browse/VD-2', columnId: 'todo-10000', labels: [], rank: 1, metadata: {} },
  ],
  swimlanes: { fidelity: 'unknown', lanes: [] },
  pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
};

describe('external issue workspace mappings', () => {
  it('persists many-to-many mappings and looks them up by exact provider/site/key', async () => {
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
      isPrimary: true,
      lastOpenedAt: '2026-07-02T09:00:00.000Z',
    });
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-2', workspaceDir: '/repo/b', displayName: 'Workspace B' },
    });

    const related = await getRelatedWorkspacesForExternalIssues(db, [
      { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      { provider: 'jira', key: 'VD-1', url: 'https://other.atlassian.net/browse/VD-1', site: 'other.atlassian.net' },
    ]);

    expect(related.get('jira:team.atlassian.net:VD-1')).toEqual([
      { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true, lastOpenedAt: '2026-07-02T09:00:00.000Z' },
      { workspaceId: 'ws-2', workspaceDir: '/repo/b', displayName: 'Workspace B', isPrimary: false },
    ]);
    expect(related.get('jira:other.atlassian.net:VD-1')).toEqual([]);
  });

  it('allows one workspace to link to multiple external issues', async () => {
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
    });
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-2', url: 'https://team.atlassian.net/browse/VD-2', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
    });

    const linkRows = await db.selectFrom('ExternalIssueWorkspaceLink').selectAll().execute();
    const workspaceRows = await db.selectFrom('VKWorkspace').selectAll().execute();

    expect(linkRows).toHaveLength(2);
    expect(workspaceRows).toHaveLength(1);
  });

  it('decorates Jira board cards without hiding unmapped cards', async () => {
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
      isPrimary: true,
    });

    const decorated = await decorateExternalKanbanBoardWithWorkspaceMappings(db, boardView);

    expect(decorated.cards).toEqual([
      expect.objectContaining({
        key: 'VD-1',
        relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true }],
      }),
      expect.objectContaining({ key: 'VD-2', relatedWorkspaces: [] }),
    ]);
  });

  it('decorates non-Jira provider boards without provider-specific imports', async () => {
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'github', key: 'jamtools/springboard#12', id: 'I_kwDO1', url: 'https://github.com/jamtools/springboard/issues/12', site: 'github.com' },
      workspace: { workspaceId: 'ws-gh', displayName: 'GitHub workspace' },
      isPrimary: true,
    });

    const githubBoard: ExternalKanbanBoardViewDto<'github'> = {
      provider: 'github',
      sourceUrl: 'https://github.com/jamtools/springboard/issues',
      siteHostname: 'github.com',
      resource: { id: 'jamtools/springboard', name: 'springboard', url: 'https://github.com/jamtools/springboard' },
      board: { id: 'jamtools/springboard', name: 'GitHub issues' },
      columns: [{ id: 'open', title: 'Open', statusIds: ['open'] }],
      cards: [
        { id: 'I_kwDO1', key: 'jamtools/springboard#12', title: 'Provider-neutral card', url: 'https://github.com/jamtools/springboard/issues/12', columnId: 'open', labels: [], rank: 0, metadata: {} },
      ],
      swimlanes: { fidelity: 'none', lanes: [] },
      pagination: { pageCount: 1, issueCount: 1, maxResults: 100 },
    };

    const decorated = await decorateExternalKanbanBoardWithWorkspaceMappings(db, githubBoard);

    expect(decorated.cards[0]?.relatedWorkspaces).toEqual([
      { workspaceId: 'ws-gh', displayName: 'GitHub workspace', isPrimary: true },
    ]);
  });

  it('decorates multiple Jira cards through one batched workspace lookup', async () => {
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
      isPrimary: true,
      lastOpenedAt: '2026-07-02T09:00:00.000Z',
    });
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-2', workspaceDir: '/repo/b', displayName: 'Workspace B' },
    });
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-2', id: '10002', url: 'https://team.atlassian.net/browse/VD-2', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-3', workspaceDir: '/repo/c', displayName: 'Workspace C' },
    });
    const threeCardBoard: ExternalKanbanBoardViewDto<'jira'> = {
      ...boardView,
      cards: [
        ...boardView.cards,
        { id: '10003', key: 'VD-3', title: 'Unmapped issue', url: 'https://team.atlassian.net/browse/VD-3', columnId: 'todo-10000', labels: [], rank: 2, metadata: {} },
      ],
      pagination: { ...boardView.pagination, issueCount: 3 },
    };
    executedSql = [];

    const decorated = await decorateExternalKanbanBoardWithWorkspaceMappings(db, threeCardBoard);

    expect(decorated.cards).toEqual([
      expect.objectContaining({
        key: 'VD-1',
        relatedWorkspaces: [
          { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true, lastOpenedAt: '2026-07-02T09:00:00.000Z' },
          { workspaceId: 'ws-2', workspaceDir: '/repo/b', displayName: 'Workspace B', isPrimary: false },
        ],
      }),
      expect.objectContaining({
        key: 'VD-2',
        relatedWorkspaces: [{ workspaceId: 'ws-3', workspaceDir: '/repo/c', displayName: 'Workspace C', isPrimary: false }],
      }),
      expect.objectContaining({ key: 'VD-3', relatedWorkspaces: [] }),
    ]);
    const workspaceLookupQueries = executedSql.filter((sql) => sql.includes('from "ExternalIssue"') && sql.includes('inner join "ExternalIssueWorkspaceLink"'));
    expect(workspaceLookupQueries).toHaveLength(1);
  });

  it('rejects invalid explicit mapping inputs', async () => {
    await expect(upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: '   ', url: 'https://team.atlassian.net/browse/VD-1' },
      workspace: { workspaceId: 'ws-1' },
    })).rejects.toThrow('external_issue_key_required');
  });
});
