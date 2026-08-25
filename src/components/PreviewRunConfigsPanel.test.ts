// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewRunConfigsPanel } from './PreviewRunConfigsPanel';

describe('PreviewRunConfigsPanel', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('selects workspace repos and uses the selected repo ID in create payloads', async () => {
    const requests: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        init,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (url === '/internal/preview/workspaces/ws1/repos') {
        return jsonResponse([
          { id: 'repo-alpha', name: 'alpha', display_name: 'Alpha App', target_branch: 'main' },
          { id: 'repo-beta', name: 'beta', display_name: 'Beta App', target_branch: 'feature/beta' },
        ]);
      }
      if (url === '/internal/preview/workspaces/ws1/run-configs' && init?.method === 'POST') {
        return jsonResponse({
          id: 'rc-new',
          ...(init.body ? JSON.parse(String(init.body)) : {}),
          created_at: '',
          updated_at: '',
        });
      }
      if (url === '/internal/preview/workspaces/ws1/preview-slots' && init?.method === 'POST') {
        return jsonResponse({
          id: 'slot-new',
          ...(init.body ? JSON.parse(String(init.body)) : {}),
          created_at: '',
          updated_at: '',
        });
      }
      if (url === '/internal/preview/workspaces/ws1/run-configs') {
        return jsonResponse({
          run_configs: [
            {
              id: 'rc-beta',
              repo_id: 'repo-beta',
              slug: 'web',
              name: 'Web',
              command: 'npm run dev',
              kind: 'long_running',
              enabled: true,
              created_at: '',
              updated_at: '',
            },
          ],
          preview_slots: [],
          preview_url_parts: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(React.createElement(PreviewRunConfigsPanel, { workspaceId: 'ws1' }));

    const repoSelect = await screen.findByLabelText('Repository');
    fireEvent.change(repoSelect, { target: { value: 'repo-beta' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save run config' }));
    await waitFor(() => {
      expect(requests).toContainEqual(expect.objectContaining({
        url: '/internal/preview/workspaces/ws1/run-configs',
        init: expect.objectContaining({ method: 'POST' }),
        body: expect.objectContaining({ repo_id: 'repo-beta' }),
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save preview slot' }));
    await waitFor(() => {
      expect(requests).toContainEqual(expect.objectContaining({
        url: '/internal/preview/workspaces/ws1/preview-slots',
        init: expect.objectContaining({ method: 'POST' }),
        body: expect.objectContaining({ repo_id: 'repo-beta' }),
      }));
    });
  });

  it('updates an existing run config when saving a matching selected repo and slug', async () => {
    const requests: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        init,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (url === '/internal/preview/workspaces/ws-update/repos') {
        return jsonResponse([
          { id: 'repo-alpha', name: 'alpha', display_name: 'Alpha App', target_branch: 'main' },
        ]);
      }
      if (url === '/internal/preview/workspaces/ws-update/run-configs' && init?.method === 'POST') {
        return jsonResponse({
          id: 'rc-existing',
          ...(init.body ? JSON.parse(String(init.body)) : {}),
          created_at: '',
          updated_at: '',
        });
      }
      if (url === '/internal/preview/workspaces/ws-update/run-configs') {
        return jsonResponse({
          run_configs: [
            {
              id: 'rc-existing',
              repo_id: 'repo-alpha',
              slug: 'web',
              name: 'Original Web',
              command: 'npm run dev',
              kind: 'long_running',
              enabled: true,
              created_at: '',
              updated_at: '',
            },
          ],
          preview_slots: [],
          preview_url_parts: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(React.createElement(PreviewRunConfigsPanel, { workspaceId: 'ws-update' }));

    await screen.findByText('Original Web');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save run config' }));

    await waitFor(() => {
      expect(requests).toContainEqual(expect.objectContaining({
        url: '/internal/preview/workspaces/ws-update/run-configs',
        init: expect.objectContaining({ method: 'POST' }),
        body: expect.objectContaining({
          id: 'rc-existing',
          repo_id: 'repo-alpha',
          slug: 'web',
          name: 'Updated Web',
        }),
      }));
    });
  });

  it('shows a readable error when the backend rejects a duplicate run config save', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/internal/preview/workspaces/ws-duplicate/repos') {
        return jsonResponse([
          { id: 'repo-alpha', name: 'alpha', display_name: 'Alpha App', target_branch: 'main' },
        ]);
      }
      if (url === '/internal/preview/workspaces/ws-duplicate/run-configs' && init?.method === 'POST') {
        return jsonResponse({ message: 'Run config slug web already exists.' }, 409);
      }
      if (url === '/internal/preview/workspaces/ws-duplicate/run-configs') {
        return jsonResponse({ run_configs: [], preview_slots: [], preview_url_parts: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(React.createElement(PreviewRunConfigsPanel, { workspaceId: 'ws-duplicate' }));

    await screen.findByText(/Using repo ID/);
    fireEvent.click(screen.getByRole('button', { name: 'Save run config' }));

    expect(await screen.findByText('Run config slug web already exists.')).toBeTruthy();
    expect(screen.queryByText(/"message"/)).toBeNull();
  });

  it('does not eagerly fetch process logs until the user clicks Logs', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === '/internal/preview/workspaces/ws-logs/repos') {
        return jsonResponse([
          { id: 'repo-alpha', name: 'alpha', display_name: 'Alpha App', target_branch: 'main' },
        ]);
      }
      if (url === '/internal/preview/workspaces/ws-logs/run-configs') {
        return jsonResponse({
          run_configs: [
            {
              id: 'rc-log',
              repo_id: 'repo-alpha',
              slug: 'web',
              name: 'Web',
              command: 'npm run dev',
              kind: 'long_running',
              enabled: true,
              created_at: '',
              updated_at: '',
            },
          ],
          preview_slots: [],
          preview_url_parts: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(React.createElement(PreviewRunConfigsPanel, { workspaceId: 'ws-logs' }));

    await screen.findByText('Web');
    expect(requests.some((url) => url.includes('/logs'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Show logs for run config Web' }));
    expect(await screen.findByText(/No process has been started/)).toBeTruthy();
    expect(requests.some((url) => url.includes('/logs'))).toBe(false);
  });

  it('loads bounded recent process logs after explicit user action', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url === '/internal/preview/workspaces/ws-load-logs/repos') {
        return jsonResponse([
          { id: 'repo-alpha', name: 'alpha', display_name: 'Alpha App', target_branch: 'main' },
        ]);
      }
      if (url === '/internal/preview/workspaces/ws-load-logs/run-configs/rc-log/start' && init?.method === 'POST') {
        return jsonResponse(startResponse('process-log-1', 'rc-log'));
      }
      if (url === '/internal/preview/workspaces/ws-load-logs/execution-processes/process-log-1/logs?timeoutMs=1500&maxEntries=200') {
        return jsonResponse({
          process_id: 'process-log-1',
          logs: [
            { type: 'STDOUT', content: 'preview listening\n' },
            { type: 'STDERR', content: 'warning only\n' },
          ],
        });
      }
      if (url === '/internal/preview/workspaces/ws-load-logs/run-configs') {
        return jsonResponse({
          run_configs: [
            {
              id: 'rc-log',
              repo_id: 'repo-alpha',
              slug: 'web',
              name: 'Web',
              command: 'npm run dev',
              kind: 'long_running',
              enabled: true,
              created_at: '',
              updated_at: '',
            },
          ],
          preview_slots: [],
          preview_url_parts: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(React.createElement(PreviewRunConfigsPanel, { workspaceId: 'ws-load-logs' }));

    await screen.findByText('Web');
    expect(requests.some((url) => url.includes('/logs'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Run on demand' }));
    await screen.findByText('Started run config process process-log-1');
    expect(requests.some((url) => url.includes('/logs'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Show logs for run config Web' }));

    expect(await screen.findByText(/preview listening/)).toBeTruthy();
    expect(await screen.findByText(/\[stderr\] warning only/)).toBeTruthy();
    expect(requests.filter((url) => url.includes('/logs'))).toHaveLength(1);
  });

  it('shows readable process log errors instead of raw JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/internal/preview/workspaces/ws-log-error/repos') {
        return jsonResponse([
          { id: 'repo-alpha', name: 'alpha', display_name: 'Alpha App', target_branch: 'main' },
        ]);
      }
      if (url === '/internal/preview/workspaces/ws-log-error/run-configs/rc-log/start' && init?.method === 'POST') {
        return jsonResponse(startResponse('process-log-err', 'rc-log'));
      }
      if (url === '/internal/preview/workspaces/ws-log-error/execution-processes/process-log-err/logs?timeoutMs=1500&maxEntries=200') {
        return jsonResponse({ message: 'Preview process log backend is unavailable' }, 502);
      }
      if (url === '/internal/preview/workspaces/ws-log-error/run-configs') {
        return jsonResponse({
          run_configs: [
            {
              id: 'rc-log',
              repo_id: 'repo-alpha',
              slug: 'web',
              name: 'Web',
              command: 'npm run dev',
              kind: 'long_running',
              enabled: true,
              created_at: '',
              updated_at: '',
            },
          ],
          preview_slots: [],
          preview_url_parts: [],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(React.createElement(PreviewRunConfigsPanel, { workspaceId: 'ws-log-error' }));

    await screen.findByText('Web');
    fireEvent.click(screen.getByRole('button', { name: 'Run on demand' }));
    await screen.findByText('Started run config process process-log-err');
    fireEvent.click(screen.getByRole('button', { name: 'Show logs for run config Web' }));

    expect(await screen.findByText('Preview process log backend is unavailable')).toBeTruthy();
    expect(screen.queryByText(/"message"/)).toBeNull();
  });

  it('shows a clear empty state and disables creation when the workspace has no repos', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/internal/preview/workspaces/ws-empty/repos') return jsonResponse([]);
      if (url === '/internal/preview/workspaces/ws-empty/run-configs') {
        return jsonResponse({ run_configs: [], preview_slots: [], preview_url_parts: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(React.createElement(PreviewRunConfigsPanel, { workspaceId: 'ws-empty' }));

    expect(await screen.findByText(/No repositories are available/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save run config' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save preview slot' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

function startResponse(processId: string, runConfigId: string) {
  return {
    execution_process: {
      id: processId,
      session_id: 'session-1',
      status: 'running',
    },
    preview_process_link: {
      id: `link-${processId}`,
      workspace_id: 'ws-load-logs',
      repo_id: 'repo-alpha',
      run_config_id: runConfigId,
      execution_process_id: processId,
      assigned_port: 4321,
      status_snapshot: 'starting',
      started_at: '',
      updated_at: '',
    },
    upstream: 'http://127.0.0.1:4321',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
