import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerPreviewResolverRoutes } from './preview-resolver-routes';
import type { PreviewResolveRequest } from './vk-client';

describe('registerPreviewResolverRoutes', () => {
  const routeClient = {
    resolvePreview: vi.fn(),
    getRunConfigs: vi.fn(),
    upsertRunConfig: vi.fn(),
    upsertPreviewSlot: vi.fn(),
    startRunConfig: vi.fn(),
    startPreviewSlot: vi.fn(),
    getPreviewSlotUrl: vi.fn(),
  };

  it('proxies named preview resolve payloads to VK', async () => {
    const resolvePreview = vi.fn(async () => ({
      status: 'ready' as const,
      upstream: 'http://127.0.0.1:4567',
      executionProcessId: 'process-1',
      workspaceId: 'workspace-1',
      previewSlotId: 'slot-1',
    }));
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: { resolvePreview } });

    const payload: PreviewResolveRequest = {
      host: 'web-vibekanban-0123456789abcdef-mickmister.vibedashboard.dev',
      workspaceToken: '0123456789abcdef',
      repoSlug: 'vibekanban',
      slotSlug: 'web',
      customerSlug: 'mickmister',
      ensure: true,
      method: 'GET',
      path: '/',
    };
    const response = await app.request('/internal/preview/resolve', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      upstream: 'http://127.0.0.1:4567',
      executionProcessId: 'process-1',
      workspaceId: 'workspace-1',
      previewSlotId: 'slot-1',
    });
    expect(resolvePreview).toHaveBeenCalledWith(payload);
  });

  it('rejects impossible tokens locally without calling VK', async () => {
    const resolvePreview = vi.fn();
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: { resolvePreview } });

    const response = await app.request('/internal/preview/resolve', {
      method: 'POST',
      body: JSON.stringify({
        host: '0123456789abcdeg-vibekanban-web-mickmister.vibedashboard.dev',
        workspaceToken: '0123456789abcdeg',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        ensure: true,
        method: 'GET',
        path: '/',
      }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'not_found',
      message: 'Invalid preview workspace token',
    });
    expect(resolvePreview).not.toHaveBeenCalled();
  });

  it('proxies run config declaration and canonical URL generation routes', async () => {
    const client = {
      ...routeClient,
      getWorkspaceRepos: vi.fn(async () => [
        { id: 'repo1', name: 'vibe-kanban', display_name: 'Vibe Kanban', target_branch: 'feature/x' },
      ]),
      getRunConfigs: vi.fn(async () => ({
        run_configs: [],
        preview_slots: [],
        preview_url_parts: [],
      })),
      upsertRunConfig: vi.fn(async (workspaceId, body) => ({ id: 'rc1', ...body })),
      upsertPreviewSlot: vi.fn(async (workspaceId, body) => ({ id: 'slot1', ...body })),
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        host: 'web-vibekanban-0123456789abcdef-mickmister.vibedashboard.dev',
        url: 'https://web-vibekanban-0123456789abcdef-mickmister.vibedashboard.dev/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    await app.request('/internal/preview/workspaces/ws1/run-configs');
    const reposResponse = await app.request('/internal/preview/workspaces/ws1/repos');
    await app.request('/internal/preview/workspaces/ws1/run-configs', {
      method: 'POST',
      body: JSON.stringify({
        repo_id: 'repo1',
        slug: 'web',
        name: 'Web',
        command: 'npm run dev',
        kind: 'long_running',
        enabled: true,
      }),
    });
    await app.request('/internal/preview/workspaces/ws1/preview-slots', {
      method: 'POST',
      body: JSON.stringify({
        repo_id: 'repo1',
        run_config_id: 'rc1',
        slot_slug: 'web',
        title: 'Web',
        enabled: true,
      }),
    });
    const urlResponse = await app.request(
      '/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=mickmister&baseDomain=vibedashboard.dev',
    );

    expect(client.getRunConfigs).toHaveBeenCalledWith('ws1');
    expect(client.getWorkspaceRepos).toHaveBeenCalledWith('ws1');
    expect(client.upsertRunConfig).toHaveBeenCalledWith('ws1', expect.objectContaining({ slug: 'web' }));
    expect(client.upsertPreviewSlot).toHaveBeenCalledWith('ws1', expect.objectContaining({ slot_slug: 'web' }));
    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'mickmister',
      baseDomain: 'vibedashboard.dev',
    });
    await expect(urlResponse.json()).resolves.toMatchObject({
      url: 'https://web-vibekanban-0123456789abcdef-mickmister.vibedashboard.dev/',
    });
    await expect(reposResponse.json()).resolves.toEqual([
      { id: 'repo1', name: 'vibe-kanban', display_name: 'Vibe Kanban', target_branch: 'feature/x' },
    ]);
  });

  it('rewrites generated Preview URLs to localhost subdomains for local Caddy mode', async () => {
    const client = {
      resolvePreview: vi.fn(),
      getRunConfigs: vi.fn(async () => ({
        run_configs: [],
        preview_slots: [],
        preview_url_parts: [],
        preview_process_links: [{
          id: 'link-1', workspace_id: 'ws1', repo_id: 'repo-1', run_config_id: 'config-1',
          preview_slot_id: 'slot-1', execution_process_id: 'process-1', assigned_port: 4000,
          status_snapshot: 'ready' as const, started_at: '', updated_at: '',
        }],
      })),
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'preview',
        host: 'web-vibekanban-0123456789abcdef-preview.localhost',
        url: 'https://web-vibekanban-0123456789abcdef-preview.localhost/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    const response = await app.request(
      '/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=preview&baseDomain=localhost&localOrigin=http%3A%2F%2Flocalhost%3A55743',
    );

    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'preview',
      baseDomain: 'localhost',
    });
    await expect(response.json()).resolves.toMatchObject({
      host: 'web-vibekanban-0123456789abcdef-preview.localhost',
      url: 'http://web-vibekanban-0123456789abcdef-preview.localhost:55743/',
    });
  });

  it('fetches process logs only for processes linked to the requested workspace', async () => {
    const client = {
      resolvePreview: vi.fn(),
      getRunConfigs: vi.fn(async () => ({
        run_configs: [], preview_slots: [], preview_url_parts: [], preview_process_links: [{
          id: 'link-1', workspace_id: 'ws1', repo_id: 'repo-1', run_config_id: 'config-1',
          preview_slot_id: 'slot-1', execution_process_id: 'process-1', assigned_port: 4000,
          status_snapshot: 'ready' as const, started_at: '', updated_at: '',
        }],
      })),
      getExecutionProcess: vi.fn(async () => ({
        id: 'process-1',
        session_id: 'session-1',
        status: 'running' as const,
      })),
      getSession: vi.fn(async () => ({
        id: 'session-1',
        workspace_id: 'ws1',
        executor: 'CODEX' as const,
        created_at: '',
        updated_at: '',
      })),
      fetchRawExecutionLogs: vi.fn(async () => [
        { type: 'STDOUT' as const, content: 'preview ready\n' },
      ]),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    const response = await app.request(
      '/internal/preview/workspaces/ws1/execution-processes/process-1/logs?timeoutMs=25&maxEntries=5',
    );

    await expect(response.json()).resolves.toEqual({
      process_id: 'process-1',
      logs: [{ type: 'STDOUT', content: 'preview ready\n' }],
    });
    expect(client.getExecutionProcess).toHaveBeenCalledWith('process-1');
    expect(client.getSession).toHaveBeenCalledWith('session-1');
    expect(client.fetchRawExecutionLogs).toHaveBeenCalledWith('process-1', {
      timeoutMs: 100,
      maxEntries: 5,
    });
  });

  it('does not fetch logs when the process session belongs to another workspace', async () => {
    const client = {
      resolvePreview: vi.fn(),
      getRunConfigs: vi.fn(async () => ({
        run_configs: [], preview_slots: [], preview_url_parts: [], preview_process_links: [{
          id: 'link-1', workspace_id: 'ws1', repo_id: 'repo-1', run_config_id: 'config-1',
          preview_slot_id: 'slot-1', execution_process_id: 'process-1', assigned_port: 4000,
          status_snapshot: 'ready' as const, started_at: '', updated_at: '',
        }],
      })),
      getExecutionProcess: vi.fn(async () => ({
        id: 'process-1',
        session_id: 'session-1',
        status: 'running' as const,
      })),
      getSession: vi.fn(async () => ({
        id: 'session-1',
        workspace_id: 'other-workspace',
        executor: 'CODEX' as const,
        created_at: '',
        updated_at: '',
      })),
      fetchRawExecutionLogs: vi.fn(),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    const response = await app.request(
      '/internal/preview/workspaces/ws1/execution-processes/process-1/logs',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: 'No PreviewServer logs found for this workspace process.',
    });
    expect(client.fetchRawExecutionLogs).not.toHaveBeenCalled();
  });

  it('does not fetch logs for an unlinked process even when its session belongs to the workspace', async () => {
    const client = {
      resolvePreview: vi.fn(),
      getRunConfigs: vi.fn(async () => ({
        run_configs: [], preview_slots: [], preview_url_parts: [], preview_process_links: [],
      })),
      getExecutionProcess: vi.fn(),
      getSession: vi.fn(),
      fetchRawExecutionLogs: vi.fn(),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    const response = await app.request('/internal/preview/workspaces/ws1/execution-processes/process-1/logs');

    expect(response.status).toBe(404);
    expect(client.getExecutionProcess).not.toHaveBeenCalled();
    expect(client.fetchRawExecutionLogs).not.toHaveBeenCalled();
  });
});
