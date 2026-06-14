import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import {
  createBeadFormSubmissionHandler,
  type BeadFormSubmissionDeps,
} from '../BeadFormSubmissionServerModule';

function createTestApp(deps: BeadFormSubmissionDeps) {
  const app = new Hono();
  app.post('/api/bead-form-submissions', createBeadFormSubmissionHandler(deps));
  return app;
}

describe('bead form submission server module integration', () => {
  it('maps a bead form webhook to a VK draft follow-up and returns the Craft link', async () => {
    const scratchUpdates: Array<{ path: string; body: unknown }> = [];
    const readBead = vi.fn(async () => ({
      id: 'Vktest-123',
      title: 'User review',
      metadata: { beadsWeb: { branch: 'vk/8299-beads-web-show-m' } },
    }));
    const vkFetch: BeadFormSubmissionDeps['vkFetch'] = async (path, init) => {
      if (path === '/workspaces') {
        return [
          {
            id: '8299d785-6908-4b32-8dc3-1f0cecc4c2ee',
            branch: 'vk/8299-beads-web-show-m',
            archived: false,
            created_at: '2026-06-14T00:00:00Z',
          },
        ] as never;
      }
      if (path === '/workspaces/8299d785-6908-4b32-8dc3-1f0cecc4c2ee/repos') {
        return [{ id: 'repo-1', name: 'Vktest', display_name: 'Vktest' }] as never;
      }
      if (path === '/sessions?workspace_id=8299d785-6908-4b32-8dc3-1f0cecc4c2ee') {
        return [{ id: 'session-1', workspace_id: '8299d785-6908-4b32-8dc3-1f0cecc4c2ee' }] as never;
      }
      if (path === '/scratch/DRAFT_FOLLOW_UP/session-1' && init?.method === 'PUT') {
        scratchUpdates.push({ path, body: JSON.parse(String(init.body)) });
        return undefined as never;
      }
      throw new Error(`Unexpected VK fetch: ${path}`);
    };
    const getSessionExecutionProcesses = vi.fn(async () => [
      {
        id: 'process-1',
        created_at: '2026-06-14T01:00:00Z',
        executor_action: {
          typ: {
            type: 'CodingAgentInitialRequest',
            executor_config: { executor: 'codex', variant: 'gpt-5.4' },
          },
        },
      },
    ]);
    const deps: BeadFormSubmissionDeps = {
      readBead,
      vkFetch,
      getSessionExecutionProcesses,
      getWorkspaceState: () => ({
        spaces: [{ id: 'space_1', name: 'Home', icon: 'home', tabGroupIds: ['tg_1'] }],
        tabGroups: [
          {
            id: 'tg_1',
            label: 'Review Craft',
            tabs: [
              {
                id: 'tab_1',
                title: 'Agent',
                url: '/workspaces/8299d785-6908-4b32-8dc3-1f0cecc4c2ee',
              },
            ],
            pairs: [],
            order: 0,
          },
        ],
        nextId: 2,
      }),
      env: { BEAD_FORM_REPO_PATH: '/repos/Vktest' },
    };

    const response = await createTestApp(deps).request('/api/bead-form-submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'dolt://Vktest',
        beadId: 'Vktest-123',
        formId: 'review',
        values: { approved: true, comment: 'Looks good' },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      '[Open the Craft](/dashboard/spaces/space_1/tg_1/tab_1)',
    );
    expect(readBead).toHaveBeenCalledWith('/repos/Vktest', 'Vktest-123');
    expect(getSessionExecutionProcesses).toHaveBeenCalledWith('session-1');
    expect(scratchUpdates).toHaveLength(1);
    expect(scratchUpdates[0]).toEqual({
      path: '/scratch/DRAFT_FOLLOW_UP/session-1',
      body: {
        payload: {
          type: 'DRAFT_FOLLOW_UP',
          data: {
            message: [
              'Submitted form for bead Vktest-123.',
              '',
              'Submitted values:',
              '- approved: true',
              '- comment: "Looks good"',
            ].join('\n'),
            executor_config: { executor: 'codex', variant: 'gpt-5.4' },
          },
        },
      },
    });
  });
});
