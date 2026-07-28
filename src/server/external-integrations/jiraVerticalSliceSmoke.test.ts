import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { buildExternalViewDashboardUrl, parseDashboardExternalViewLocator } from '../../lib/externalViewUrl';
import type { DB } from '../../store/kysely_types';
import { ExternalJiraBoardContent } from '../../components/ExternalJiraBoardView';
import type { ExternalTrackerAuthService } from './auth';
import { registerExternalTrackerBoardRoutes } from './boardRoutes';
import type { FetchJiraBoardView } from './boardRoutes';
import { migrateExternalIntegrationsDb } from './migrate';
import { upsertExternalIssueWorkspaceMapping } from './workspaceMappings';

const jiraBoardUrl = 'https://team.atlassian.net/jira/software/projects/VD/boards/42?selectedIssue=VD-1';

function createAuthService(session: Awaited<ReturnType<ExternalTrackerAuthService['getSession']>>): ExternalTrackerAuthService {
  return {
    getSession: vi.fn(async () => session),
    linkSocialAccount: vi.fn(async ({ provider }) => ({ url: `https://auth.test/${provider}` })),
    handler: vi.fn(async () => new Response('auth handler')),
  };
}

async function seedUserAndAtlassianAccount(db: Kysely<DB>): Promise<void> {
  const now = new Date().toISOString() as unknown as Date;
  await db.insertInto('BetterAuthUser').values({
    id: 'user_1',
    name: 'User One',
    email: 'u@example.com',
    emailVerified: 0,
    image: null,
    createdAt: now,
    updatedAt: now,
  } as any).execute();
  await db.insertInto('BetterAuthAccount').values({
    id: 'account_1',
    userId: 'user_1',
    accountId: 'atlassian_account_1',
    providerId: 'atlassian',
    accessToken: 'jira-token',
    refreshToken: null,
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString() as unknown as Date,
    refreshTokenExpiresAt: null,
    scope: 'read:jira-work',
    idToken: null,
    password: null,
    createdAt: now,
    updatedAt: now,
  } as any).execute();
}

describe('Jira external board vertical slice smoke', () => {
  it('opens an extension-style Jira board URL, fetches fixture data, decorates cards, and renders read-only board output', async () => {
    const sqlite = new Database(':memory:');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    try {
      await migrateExternalIntegrationsDb(db);
      await seedUserAndAtlassianAccount(db);
      await upsertExternalIssueWorkspaceMapping(db, {
        externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
        workspace: { workspaceId: 'ws-1', workspaceDir: '/repos/Vktest', displayName: 'Vktest workspace' },
        isPrimary: true,
      });

      const launchUrl = buildExternalViewDashboardUrl({
        dashboardOrigin: 'https://vd.example.test/',
        externalViewUrl: jiraBoardUrl,
      });
      const launchSearch = new URL(launchUrl).search;
      expect(parseDashboardExternalViewLocator(launchSearch)).toEqual({
        status: 'ok',
        sourceParam: 'external_view_url',
        locator: expect.objectContaining({
          provider: 'jira',
          viewKind: 'board',
          boardId: '42',
          projectKey: 'VD',
          siteHostname: 'team.atlassian.net',
          originalUrl: jiraBoardUrl,
        }),
      });

      const adapter = vi.fn(async () => ({
        ok: true as const,
        boardView: {
          provider: 'jira' as const,
          sourceUrl: jiraBoardUrl,
          siteHostname: 'team.atlassian.net',
          resource: { id: 'cloud-1', name: 'Team Jira', url: 'https://team.atlassian.net' },
          board: { id: '42', name: 'VD Integration Board', type: 'kanban', projectKey: 'VD' },
          columns: [
            { id: 'todo-10000', title: 'To Do', statusIds: ['10000'] },
            { id: 'done-10002', title: 'Done', statusIds: ['10002'] },
          ],
          cards: [
            {
              id: '10001',
              key: 'VD-1',
              title: 'Replicate Jira board in VD',
              url: 'https://team.atlassian.net/browse/VD-1',
              statusId: '10000',
              statusName: 'To Do',
              columnId: 'todo-10000',
              issueType: 'Task',
              labels: ['external-trackers'],
              rank: 0,
              metadata: {},
            },
            {
              id: '10002',
              key: 'VD-2',
              title: 'Keep read-only smoke deterministic',
              url: 'https://team.atlassian.net/browse/VD-2',
              statusId: '10002',
              statusName: 'Done',
              columnId: 'done-10002',
              issueType: 'Task',
              labels: [],
              rank: 1,
              metadata: {},
            },
          ],
          swimlanes: {
            fidelity: 'none' as const,
            lanes: [],
            reason: 'No swimlane grouping was requested.',
          },
          pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
        },
      })) as unknown as FetchJiraBoardView;
      const beads = {
        runBd: vi.fn(async () => ({
          stdout: `${JSON.stringify({
            id: 'vkvw-573j.8',
            title: 'M8 smoke linked bead',
            status: 'open',
            metadata: {
              external_issues: [{ provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }],
            },
          })}\n`,
        })),
      };
      const app = new Hono();
      registerExternalTrackerBoardRoutes(app, {
        enabled: true,
        auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
        db,
        fetchJiraBoardView: adapter,
        beads,
      });

      const response = await app.request(`/dashboard/api/external-trackers/jira/board${launchSearch}`);
      expect(response.status).toBe(200);
      const payload = await response.json() as any;
      expect(payload.ok).toBe(true);
      expect(adapter).toHaveBeenCalledWith({
        locator: expect.objectContaining({ provider: 'jira', viewKind: 'board', boardId: '42', siteHostname: 'team.atlassian.net' }),
        accessToken: 'jira-token',
      });
      expect(beads.runBd).toHaveBeenCalledWith(['export']);
      expect(payload.boardView.cards).toEqual([
        expect.objectContaining({
          key: 'VD-1',
          relatedWorkspaces: [expect.objectContaining({ workspaceId: 'ws-1', displayName: 'Vktest workspace', isPrimary: true })],
          relatedBeads: [expect.objectContaining({ id: 'vkvw-573j.8', title: 'M8 smoke linked bead' })],
        }),
        expect.objectContaining({ key: 'VD-2', relatedWorkspaces: [], relatedBeads: [] }),
      ]);

      const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: payload.boardView }));
      expect(html).toContain('VD Integration Board');
      expect(html).toContain('Open in Jira');
      expect(html).toContain('Convert VK workspaces');
      expect(html).toContain('To Do');
      expect(html).toContain('Replicate Jira board in VD');
      expect(html).toContain('Show Done');
      expect(html).toContain('Existing workspace');
      expect(html).toContain('Open Workspace');
      expect(html).toContain('0/1 tasks complete');
      expect(html).toContain('Next up: M8 smoke linked bead');
    } finally {
      await db.destroy();
      sqlite.close();
    }
  });
});
