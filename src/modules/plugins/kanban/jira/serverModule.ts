import { serverRegistry } from 'springboard/server/register';
import { createExternalTrackerAuth, createExternalTrackerAuthService } from './server/auth';
import type { ExternalTrackerAuthService } from './server/auth';
import { getExternalIntegrationsDb } from '../server/database';
import { registerExternalTrackerBoardRoutes } from './server/boardRoutes';
import { registerExternalTrackerAuthRoutes } from './server/routes';

serverRegistry.registerServerModule((api) => {
  const handlePromise = getExternalIntegrationsDb();
  const auth = createLazyExternalTrackerAuthService(async () => {
    const handle = await handlePromise;
    return createExternalTrackerAuthService(createExternalTrackerAuth({
      sqlite: handle.sqlite,
      kysely: handle.db,
    }));
  });

  registerExternalTrackerAuthRoutes(api.hono, { auth });
  registerExternalTrackerBoardRoutes(api.hono, { auth, getDb: async () => (await handlePromise).db });
});

function createLazyExternalTrackerAuthService(createAuth: () => Promise<ExternalTrackerAuthService>): ExternalTrackerAuthService {
  let authPromise: Promise<ExternalTrackerAuthService> | undefined;
  const getAuth = () => {
    authPromise ??= createAuth();
    return authPromise;
  };

  return {
    getSession: async (headers) => (await getAuth()).getSession(headers),
    linkSocialAccount: async (args) => (await getAuth()).linkSocialAccount(args),
    handler: async (request) => (await getAuth()).handler(request),
  };
}
