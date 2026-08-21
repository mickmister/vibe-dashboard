import { serverRegistry } from 'springboard/server/register';
import { createExternalTrackerAuth, createExternalTrackerAuthService } from './server/auth';
import { getExternalIntegrationsDb } from '../server/database';
import { registerExternalTrackerBoardRoutes } from './server/boardRoutes';
import { registerExternalTrackerAuthRoutes } from './server/routes';
import type { ExternalTrackerAuthService } from './server/auth';

serverRegistry.registerServerModule((api) => {
  const auth = createLazyExternalTrackerAuthService();
  registerExternalTrackerAuthRoutes(api.hono, { auth });
  registerExternalTrackerBoardRoutes(api.hono, {
    auth,
    db: async () => (await getExternalIntegrationsDb()).db,
  });
});

function createLazyExternalTrackerAuthService(): ExternalTrackerAuthService {
  let service: Promise<ExternalTrackerAuthService> | undefined;
  const getService = async () => {
    service ??= getExternalIntegrationsDb().then((handle) =>
      createExternalTrackerAuthService(createExternalTrackerAuth({
        sqlite: handle.sqlite,
        kysely: handle.db,
      })),
    );
    return service;
  };

  return {
    getSession: async (headers) => (await getService()).getSession(headers),
    linkSocialAccount: async (args) => (await getService()).linkSocialAccount(args),
    handler: async (request) => (await getService()).handler(request),
  };
}
