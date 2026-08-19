import { serverRegistry } from 'springboard/server/register';
import { getExternalIntegrationsDb } from '../server/database';
import { registerBeadsBoardRoutes } from './server/boardRoutes';

serverRegistry.registerServerModule(async (api) => {
  const handle = await getExternalIntegrationsDb();
  registerBeadsBoardRoutes(api.hono, { db: handle.db });
});
