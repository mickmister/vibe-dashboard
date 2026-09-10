import { serverRegistry } from 'springboard/server/register';
import { createExternalTrackerAuth, createExternalTrackerAuthService } from './server/auth';
import { getExternalIntegrationsDb } from '../server/database';
import { registerExternalTrackerBoardRoutes } from './server/boardRoutes';
import { registerExternalTrackerAuthRoutes } from './server/routes';

serverRegistry.registerServerModule(async (api) => {
  const handle = await getExternalIntegrationsDb();
  const auth = createExternalTrackerAuthService(createExternalTrackerAuth({
    sqlite: handle.sqlite,
    kysely: handle.db,
  }));

  registerExternalTrackerAuthRoutes(api.hono, { auth });
  registerExternalTrackerBoardRoutes(api.hono, { auth, db: handle.db });
});
