import { serverRegistry } from 'springboard/server/register';
import { isExternalTrackersEnabled } from '../config';
import { getExternalIntegrationsDb } from '../server/database';
import { registerLinearBoardRoutes } from './server/boardRoutes';

serverRegistry.registerServerModule(async (api) => {
  const enabled = isExternalTrackersEnabled();
  if (!enabled) return;

  const handle = await getExternalIntegrationsDb();
  registerLinearBoardRoutes(api.hono, { enabled, db: handle.db });
});
