import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { ExternalTrackerAuthService } from './auth';
import { registerExternalTrackerAuthRoutes } from './routes';

function createAuthService(session: Awaited<ReturnType<ExternalTrackerAuthService['getSession']>>): ExternalTrackerAuthService {
  return {
    getSession: vi.fn(async () => session),
    linkSocialAccount: vi.fn(async ({ provider }) => ({ url: `https://auth.test/${provider}` })),
    handler: vi.fn(async () => new Response('auth handler')),
  };
}

describe('external tracker auth routes', () => {
  it('reports auth status without a feature gate', async () => {
    const app = new Hono();
    registerExternalTrackerAuthRoutes(app, { enabled: false, auth: createAuthService(null) });

    const response = await app.request('/dashboard/api/external-trackers/auth/status');
    await expect(response.json()).resolves.toEqual({ enabled: true, authenticated: false });
  });

  it('requires an existing signed-in user before provider linking', async () => {
    const app = new Hono();
    const auth = createAuthService(null);
    registerExternalTrackerAuthRoutes(app, { enabled: true, auth });

    const response = await app.request('/dashboard/api/external-trackers/auth/jira/link', { method: 'POST' });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'authentication_required' });
    expect(auth.linkSocialAccount).not.toHaveBeenCalled();
  });

  it('uses Better Auth social linking for Jira on an existing user', async () => {
    const app = new Hono();
    const auth = createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'U' } });
    registerExternalTrackerAuthRoutes(app, { enabled: true, auth });

    const response = await app.request('/dashboard/api/external-trackers/auth/jira/link', {
      method: 'POST',
      body: JSON.stringify({ callbackURL: '/dashboard' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(auth.linkSocialAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'jira',
      callbackURL: '/dashboard',
    }));
  });

  it('rejects unknown providers before any link attempt', async () => {
    const app = new Hono();
    const auth = createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'U' } });
    registerExternalTrackerAuthRoutes(app, { enabled: true, auth });

    const response = await app.request('/dashboard/api/external-trackers/auth/asana/link', { method: 'POST' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'unsupported_external_tracker_provider' });
    expect(auth.linkSocialAccount).not.toHaveBeenCalled();
  });
});
