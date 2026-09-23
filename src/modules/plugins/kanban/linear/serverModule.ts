import { serverRegistry } from 'springboard/server/register';
import { getExternalIntegrationsDb } from '../server/database';
import { registerLinearBoardRoutes } from './server/boardRoutes';
import { dockviewM32HarnessDataMigrationDependencies } from '../../../../dockview/DockviewM32HarnessStartup';

serverRegistry.registerServerModule(async (api) => {
  const handle = await getExternalIntegrationsDb(dockviewM32HarnessDataMigrationDependencies());
  registerLinearBoardRoutes(api.hono, { db: handle.db });
});
