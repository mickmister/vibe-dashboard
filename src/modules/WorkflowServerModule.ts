import { serverRegistry } from 'springboard/server/register';
import { registerWorkflowRoutes } from '../server/workflow-routes';
import { workflowRegistry } from '../workflows/registry';
import springboard from 'springboard';
import { StateSupervisor } from 'springboard/core';

serverRegistry.registerServerModule((api) => {
  const getCachedGitRepos = () => api.getEngine().moduleRegistry.getModule('GitRepos').states.cachedRepos.getState();
  const setCachedGitRepos = (repos: CachedRepo[]) => api.getEngine().moduleRegistry.getModule('GitRepos').states.cachedRepos.setState(repos);
  registerWorkflowRoutes(api.hono, { registry: workflowRegistry });
});

springboard.registerModule('GitRepos', {}, async (moduleAPI) => {
  const states = await moduleAPI.createStates({
      cachedRepos: [] as CachedRepo[],
  });

  return {
      states,
  };
});

type CachedRepo = {
  name: string;
  aliases: string[];
}

type GitReposModuleReturnValue = {
  states: {
    cachedRepos: StateSupervisor<CachedRepo[]>
  };
}

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    GitRepos: GitReposModuleReturnValue;
  }
}