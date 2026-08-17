import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serverRegistry } from 'springboard/server/register';
import { registerWorkflowRoutes } from '../server/workflow-routes';
import { registerPluginAssetRoutes } from '../server/plugin-asset-routes';
import { registerPluginAdminRoutes } from '../server/plugin-admin-routes';
import { getVdDb } from '../server/database';
import { DbWorkflowRunRecorder } from '../server/workflow-run-recorder';
import { DbWorkflowRunReader } from '../server/workflow-run-store';
import { DbWorkflowOrchestrationStore } from '../server/workflow-orchestration-store';
import { WorkflowActivityScanner } from '../server/workflow-session-scanner';
import { WorkflowScopedTriggerSatisfier } from '../server/workflow-scoped-trigger-satisfier';
import { VibeKanbanServerClient } from '../server/vk-client';
import { WorkflowRoleSessionResolver } from '../server/role-session-resolver';
import { DbWorkspaceLaneStore } from '../server/workspace-lane-store';
import { DbResponsePipeStore } from '../server/response-pipe-store';
import { ResponsePipeService } from '../server/response-pipe-service';
import { DbDeclarativeWorkflowDefinitionStore } from '../server/declarative-workflow-definition-store';
import { DbWorkflowWebhookInboxStore, WorkflowWebhookWakeup } from '../server/workflow-webhook-inbox';
import { DbWorkflowWebhookProvisioningStore } from '../server/workflow-webhook-provisioning-store';
import { DbWorkflowDesignStore } from './plugins/workflows/server/workflowDesignStore';
import { BUILT_IN_WORKFLOW_TEMPLATES } from './plugins/workflows/templates/builtInWorkflowTemplates';
import { WorkflowWebhookProvisioner, shouldStartWorkflowWebhookProvisioner } from '../server/workflow-webhook-provisioner';
import { DeclarativeWorkflowRuntime } from '../workflows/declarative/runtime';
import { createDeclarativeWorkflowWorker, getDeclarativeWorkflowWorkerIntervalMs, shouldStartDeclarativeWorkflowWorker } from '../workflows/declarative/worker';
import { workflowRegistry } from '../workflows/registry';
import type { CachedRepoAlias } from '../workflows/github-ci';

const execFileAsync = promisify(execFile);
const reposRoot = process.env.VK_REPOS_ROOT || join(process.env.HOME || '/home/vkuser', 'repos');
const pluginInstallRoot = process.env.VD_PLUGIN_INSTALL_ROOT || join(process.cwd(), 'plugins');
let cachedGitRepos: CachedRepoAlias[] | null = null;

serverRegistry.registerServerModule((api) => {
  const workflowOrchestrationStore = new DbWorkflowOrchestrationStore({
    getDb: async () => (await getVdDb()).db,
  });
  const vkClient = new VibeKanbanServerClient();
  const roleSessionResolver = new WorkflowRoleSessionResolver({
    getDb: async () => (await getVdDb()).db,
    vk: vkClient,
  });
  const workflowActivityScanner = new WorkflowActivityScanner({
    getDb: async () => (await getVdDb()).db,
    orchestrationStore: workflowOrchestrationStore,
    vk: vkClient,
  });
  const responsePipeStore = new DbResponsePipeStore({ getDb: async () => (await getVdDb()).db });
  const declarativeWorkflowDefinitionStore = new DbDeclarativeWorkflowDefinitionStore({ getDb: async () => (await getVdDb()).db });
  const workflowWebhookInboxStore = new DbWorkflowWebhookInboxStore({ getDb: async () => (await getVdDb()).db });
  const workflowWebhookProvisioningStore = new DbWorkflowWebhookProvisioningStore({ getDb: async () => (await getVdDb()).db });
  const workflowDesignStore = new DbWorkflowDesignStore({ getDb: async () => (await getVdDb()).db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
  const workspaceLaneStore = new DbWorkspaceLaneStore({ getDb: async () => (await getVdDb()).db });
  const declarativeWorkflowRuntime = new DeclarativeWorkflowRuntime({
    store: workflowOrchestrationStore,
    resolver: roleSessionResolver,
    vk: vkClient,
    responsePipe: new ResponsePipeService({
      store: responsePipeStore,
      vk: vkClient,
    }),
    scopedTriggerSatisfier: new WorkflowScopedTriggerSatisfier({
      scanner: workflowActivityScanner,
      orchestrationStore: workflowOrchestrationStore,
      policy: { maxActiveExecutions: 8 },
    }),
    notificationStore: responsePipeStore,
  });
  const workflowWebhookWakeup = new WorkflowWebhookWakeup(() => declarativeWorkflowRuntime.runReady());
  if (shouldStartWorkflowWebhookProvisioner()) {
    new WorkflowWebhookProvisioner({
      store: workflowWebhookProvisioningStore,
      vk: vkClient,
      logger: console,
    }).start();
  }
  if (shouldStartDeclarativeWorkflowWorker()) {
    createDeclarativeWorkflowWorker({
      runtime: declarativeWorkflowRuntime,
      intervalMs: getDeclarativeWorkflowWorkerIntervalMs(),
    });
  }
  registerWorkflowRoutes(api.hono, {
    registry: workflowRegistry,
    repoAliasCache: {
      get: getCachedGitRepos,
      set: setCachedGitRepos,
      refresh: refreshCachedGitRepos,
    },
    workflowRunRecorder: new DbWorkflowRunRecorder({
      getDb: async () => (await getVdDb()).db,
    }),
    workflowRunReader: new DbWorkflowRunReader({
      getDb: async () => (await getVdDb()).db,
    }),
    workflowOrchestrationStore,
    roleSessionResolver,
    workflowActivityScanner,
    declarativeWorkflowRuntime,
    declarativeWorkflowDefinitionStore,
    workflowWebhookInboxStore,
    workflowWebhookWakeup,
    workflowWebhookProvisioningStore,
    workflowDesignStore,
    workspaceLaneStore,
    vkClient,
  });
  registerPluginAssetRoutes(api.hono, { installRoot: pluginInstallRoot });
  registerPluginAdminRoutes(api.hono);
});

async function getCachedGitRepos(): Promise<CachedRepoAlias[]> {
  cachedGitRepos ??= await hydrateLocalGitRepoAliases(reposRoot);
  return cachedGitRepos;
}

function setCachedGitRepos(repos: CachedRepoAlias[]): void {
  cachedGitRepos = repos;
}

async function refreshCachedGitRepos(): Promise<CachedRepoAlias[]> {
  cachedGitRepos = await hydrateLocalGitRepoAliases(reposRoot);
  return cachedGitRepos;
}

async function hydrateLocalGitRepoAliases(root: string): Promise<CachedRepoAlias[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    console.warn('Failed to read local git repo root for alias cache', { root, error });
    return [];
  }

  const repos = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry): Promise<CachedRepoAlias | null> => {
      const repoPath = join(root, entry.name);
      const aliases = await getGitRemoteAliases(repoPath);
      return aliases.length > 0 ? { name: entry.name, aliases } : null;
    }));

  return repos.filter((repo): repo is CachedRepoAlias => repo !== null);
}

async function getGitRemoteAliases(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'remote', 'get-url', 'origin']);
    const remote = stdout.trim();
    return remote ? [remote] : [];
  } catch {
    return [];
  }
}
