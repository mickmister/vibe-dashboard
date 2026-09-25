import { serverRegistry } from 'springboard/server/register';
import { getExternalIntegrationsDb } from '../server/database';
import { registerLinearBoardRoutes } from './server/boardRoutes';

serverRegistry.registerServerModule((api) => {
  const handlePromise = getExternalIntegrationsDb();
  registerLinearBoardRoutes(api.hono, { getDb: async () => (await handlePromise).db });
});
