import { serverRegistry } from 'springboard/server/register';
import { getExternalIntegrationsDb } from '../server/database';
import { registerLinearBoardRoutes } from './server/boardRoutes';

serverRegistry.registerServerModule((api) => {
  registerLinearBoardRoutes(api.hono, {
    db: async () => (await getExternalIntegrationsDb()).db,
  });
});
