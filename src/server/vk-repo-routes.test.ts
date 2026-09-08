import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerVkRepoRoutes } from './vk-repo-routes';

describe('registerVkRepoRoutes', () => {
  it('clones a GitHub repository under ~/repos and registers it with VK', async () => {
    const app = new Hono();
    const cloneRepo = vi.fn(async () => '/tmp/repos/example');
    const vkClient = {
      registerRepo: vi.fn(async () => ({ id: 'repo-2', path: '/tmp/repos/example', name: 'example', display_name: 'example', default_target_branch: 'origin/main' })),
    };
    registerVkRepoRoutes(app, { enabled: true, vkClient, cloneRepo, reposRoot: '/tmp/repos' });

    const response = await app.request('/dashboard/api/external-trackers/vk/repos/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/acme/example' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, repo: expect.objectContaining({ id: 'repo-2' }) });
    expect(cloneRepo).toHaveBeenCalledWith({ githubUrl: 'https://github.com/acme/example.git', repoName: 'example', reposRoot: '/tmp/repos' });
    expect(vkClient.registerRepo).toHaveBeenCalledWith({ path: '/tmp/repos/example', display_name: undefined });
  });

  it('validates GitHub clone URLs before invoking clone/register', async () => {
    const app = new Hono();
    const cloneRepo = vi.fn();
    const vkClient = { registerRepo: vi.fn() };
    registerVkRepoRoutes(app, { enabled: true, vkClient, cloneRepo, reposRoot: '/tmp/repos' });

    const response = await app.request('/dashboard/api/external-trackers/vk/repos/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://evil.example/repo.git' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_github_repo_url' }) });
    expect(cloneRepo).not.toHaveBeenCalled();
    expect(vkClient.registerRepo).not.toHaveBeenCalled();
  });
});
