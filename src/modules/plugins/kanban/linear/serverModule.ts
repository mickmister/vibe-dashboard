import { serverRegistry } from 'springboard/server/register';
import { getExternalIntegrationsDb } from '../server/database';
import { registerLinearBoardRoutes } from './server/boardRoutes';
import { externalTrackerDataMigrationDependencies } from '../server/voyageDataMigrationDependencies';

serverRegistry.registerServerModule(async (api) => {
  const handle = await getExternalIntegrationsDb(await externalTrackerDataMigrationDependencies());
  registerLinearBoardRoutes(api.hono, { db: handle.db });
});
