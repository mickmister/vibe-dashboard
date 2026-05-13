import { serverRegistry } from 'springboard/server/register';
import { registerWorkflowRoutes } from '../server/workflow-routes';
import { workflowRegistry } from '../workflows/registry';

serverRegistry.registerServerModule(({ hono }) => {
  registerWorkflowRoutes(hono, { registry: workflowRegistry });
});
