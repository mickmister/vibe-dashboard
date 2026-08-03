import { serverRegistry } from 'springboard/server/register';
import { createExternalTrackerAuth, createExternalTrackerAuthService } from './server/auth';
import { isExternalTrackersEnabled } from '../config';
import { getExternalIntegrationsDb } from '../server/database';
import { registerExternalTrackerBoardRoutes } from './server/boardRoutes';
import { registerExternalTrackerAuthRoutes } from './server/routes';

serverRegistry.registerServerModule(async (api) => {
  const enabled = isExternalTrackersEnabled();
  if (!enabled) return;

  const handle = await getExternalIntegrationsDb();
  const auth = createExternalTrackerAuthService(createExternalTrackerAuth({
    sqlite: handle.sqlite,
    kysely: handle.db,
  }));

  registerExternalTrackerAuthRoutes(api.hono, { enabled, auth });
  registerExternalTrackerBoardRoutes(api.hono, { enabled, auth, db: handle.db });
});
