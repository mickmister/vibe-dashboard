import { serverRegistry } from 'springboard/server/register';
import { createExternalTrackerAuth, createExternalTrackerAuthService } from '../server/external-integrations/auth';
import { isExternalTrackersEnabled } from '../server/external-integrations/config';
import { getExternalIntegrationsDb } from '../server/external-integrations/database';
import { registerExternalTrackerAuthRoutes } from '../server/external-integrations/routes';

serverRegistry.registerServerModule(async (api) => {
  const enabled = isExternalTrackersEnabled();
  if (!enabled) return;

  const handle = await getExternalIntegrationsDb();
  const auth = createExternalTrackerAuthService(createExternalTrackerAuth({
    sqlite: handle.sqlite,
    kysely: handle.db,
  }));

  registerExternalTrackerAuthRoutes(api.hono, { enabled, auth });
});
