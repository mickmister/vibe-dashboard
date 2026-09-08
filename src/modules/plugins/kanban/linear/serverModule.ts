import { serverRegistry } from 'springboard/server/register';
import { getExternalIntegrationsDb } from '../server/database';
import { registerLinearBoardRoutes } from './server/boardRoutes';

serverRegistry.registerServerModule(async (api) => {
  const handle = await getExternalIntegrationsDb();
  registerLinearBoardRoutes(api.hono, { db: handle.db });
});
