import type { Hono } from 'hono';
import type { ExternalTrackerAuthService } from './auth';
import { getJiraProviderScopes, isJiraExternalTrackerProvider } from './config';

export function registerExternalTrackerAuthRoutes(
  hono: Hono,
  options: {
    enabled: boolean;
    auth: ExternalTrackerAuthService;
  },
): void {
  hono.all('/dashboard/api/auth/*', (c) => {
    if (!options.enabled) {
      return c.json({ error: 'external_trackers_disabled' }, 404);
    }
    return options.auth.handler(c.req.raw);
  });

  hono.get('/dashboard/api/external-trackers/auth/status', async (c) => {
    if (!options.enabled) {
      return c.json({ enabled: false, authenticated: false });
    }

    const session = await options.auth.getSession(c.req.raw.headers);
    return c.json({
      enabled: true,
      authenticated: Boolean(session),
      userId: session?.user.id,
    });
  });

  hono.post('/dashboard/api/external-trackers/auth/:provider/link', async (c) => {
    if (!options.enabled) {
      return c.json({ error: 'external_trackers_disabled' }, 404);
    }

    const provider = c.req.param('provider');
    if (!isJiraExternalTrackerProvider(provider)) {
      return c.json({ error: 'unsupported_external_tracker_provider' }, 400);
    }

    const session = await options.auth.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'authentication_required' }, 401);
    }

    const body = await c.req.json().catch(() => ({} as { callbackURL?: string }));
    const result = await options.auth.linkSocialAccount({
      headers: c.req.raw.headers,
      provider,
      callbackURL: typeof body.callbackURL === 'string' ? body.callbackURL : undefined,
    });

    if (result instanceof Response) return result;
    return c.json({ provider, scopes: getJiraProviderScopes(), result });
  });
}
