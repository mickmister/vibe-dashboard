import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerVkWorkspaceRoutes } from './vk-workspace-routes';

describe('registerVkWorkspaceRoutes', () => {
  it('lists active workspaces for dashboard workspace links without external-provider coupling', async () => {
    const app = new Hono();
    registerVkWorkspaceRoutes(app, {
      vkClient: {
        getWorkspaces: vi.fn(async () => [
          {
            id: 'ws-2',
            task_id: null,
            container_ref: null,
            branch: 'vk/b',
            agent_working_dir: '/work/ws-2',
            created_at: '2026-07-29T00:00:00Z',
            updated_at: '2026-07-29T00:00:00Z',
            archived: false,
            pinned: false,
            name: 'B workspace',
          },
          {
            id: 'ws-archived',
            task_id: null,
            container_ref: null,
            branch: 'vk/old',
            agent_working_dir: null,
            created_at: '2026-07-29T00:00:00Z',
            updated_at: '2026-07-29T00:00:00Z',
            archived: true,
            pinned: false,
            name: 'Archived',
          },
        ]),
      },
    });

    const response = await app.request('/dashboard/api/vk/workspace-open-options');

    await expect(response.json()).resolves.toEqual({
      ok: true,
      workspaces: [
        {
          workspaceId: 'ws-2',
          displayName: 'B workspace',
          branch: 'vk/b',
          workspaceDir: '/work/ws-2',
        },
      ],
    });
  });
});
