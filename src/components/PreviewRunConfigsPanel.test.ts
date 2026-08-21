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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
