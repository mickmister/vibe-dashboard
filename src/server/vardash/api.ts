import { join } from 'node:path';
import type { Context, Hono } from 'hono';

import { defaultVardashPrivateDir } from './key-manager';
import { importVardashEnv, parseDotenv, type VardashEnvImportSource } from './import-parser';
import { VibeKanbanServerClient } from '../vk-client';
import {
  VardashLaunchError,
  VardashLaunchRunner,
  getVardashLaunchReadiness,
  prepareVardashRepoProcessLaunch,
} from './launch';
import { ensureLegacyDevServerProcessDefinition } from './process-definitions';
import { SqlcipherVardashStore, type VardashStore, type VardashValueKind } from './store';

export interface VardashWorkspaceRepoValidationInput {
  workspaceId: string;
  repoId: string;
}

export interface RegisterVardashRoutesOptions {
  store?: VardashStore;
  dbPath?: string;
  privateDir?: string;
  validateWorkspaceRepo?: (input: VardashWorkspaceRepoValidationInput) => Promise<void>;
  launchRunner?: VardashLaunchRunner;
  launchBaseEnv?: Record<string, string | undefined>;
  launchAllowBaseEnvKeys?: readonly string[];
}

export interface VardashImportConflict {
  key: string;
  reason: 'duplicate_key_in_import' | 'saved_value_name_exists' | 'secret_to_plain_with_existing_values';
  savedValueName?: string;
}

export const VARDASH_DESCRIPTION_GUIDANCE = 'Descriptions are metadata. Do not include secret material.';

const DEFAULT_VARDASH_LAUNCH_RUNNER = new VardashLaunchRunner();

export function registerVardashRoutes(app: Hono, options: RegisterVardashRoutesOptions = {}): void {
  const getStore = memoizeStore(options);
  const launchRunner = options.launchRunner ?? DEFAULT_VARDASH_LAUNCH_RUNNER;

  app.get('/dashboard/api/vardash/workspaces/:workspaceId/repos/:repoId/env-overview', async (c) => {
    const store = await getStore();
    const overview = await store.listRepoEnvOverview({
      workspaceId: c.req.param('workspaceId'),
      repoId: c.req.param('repoId'),
    });
    return c.json({ ...overview, descriptionGuidance: VARDASH_DESCRIPTION_GUIDANCE });
  });

  app.get('/dashboard/api/vardash/repos/:repoId/env-overview', async (c) => {
    const store = await getStore();
    const overview = await store.listRepoEnvOverview({ repoId: c.req.param('repoId') });
    return c.json({ ...overview, descriptionGuidance: VARDASH_DESCRIPTION_GUIDANCE });
  });

  app.get('/dashboard/api/vardash/repos/:repoId/env-keys', async (c) => {
    const store = await getStore();
    const keys = await store.listRepoEnvKeys(c.req.param('repoId'));
    return c.json({ keys, descriptionGuidance: VARDASH_DESCRIPTION_GUIDANCE });
  });

  app.post('/dashboard/api/vardash/repos/:repoId/env-keys', async (c) => {
    const body = await readJson(c);
    const kind = readKind(body.kind);
    if (!kind) return c.json({ error: 'kind_required' }, 400);
    const key = readString(body.key);
    if (!key) return c.json({ error: 'key_required' }, 400);

    try {
      const store = await getStore();
      const envKey = await store.upsertRepoEnvKey({
        repoId: c.req.param('repoId'),
        key,
        kind,
        required: body.required === true,
        description: body.description == null ? null : readString(body.description),
      });
      return c.json({ key: envKey, descriptionGuidance: VARDASH_DESCRIPTION_GUIDANCE });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 409);
    }
  });

  app.get('/dashboard/api/vardash/repos/:repoId/env-keys/:envKeyId/saved-values', async (c) => {
    const store = await getStore();
    const values = await store.listSavedValues(c.req.param('repoId'), c.req.param('envKeyId'));
    return c.json({ values });
  });

  app.post('/dashboard/api/vardash/repos/:repoId/env-keys/:envKeyId/saved-values', async (c) => {
    const body = await readJson(c);
    const name = readString(body.name);
    const value = readString(body.value);
    if (!name) return c.json({ error: 'name_required' }, 400);
    if (value == null) return c.json({ error: 'value_required' }, 400);

    try {
      const store = await getStore();
      const savedValue = await store.createSavedValue({
        repoId: c.req.param('repoId'),
        envKeyId: c.req.param('envKeyId'),
        name,
        value,
      });
      return c.json({ savedValue });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 409);
    }
  });

  app.put('/dashboard/api/vardash/repos/:repoId/env-keys/:envKeyId/saved-values/:savedValueId', async (c) => {
    const body = await readJson(c);
    const name = readString(body.name);
    const value = readString(body.value);
    if (!name) return c.json({ error: 'name_required' }, 400);
    if (value == null) return c.json({ error: 'value_required' }, 400);

    try {
      const store = await getStore();
      const savedValue = await store.replaceSavedValue({
        repoId: c.req.param('repoId'),
        envKeyId: c.req.param('envKeyId'),
        savedValueId: c.req.param('savedValueId'),
        name,
        value,
      });
      return c.json({ savedValue });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 409);
    }
  });

  app.post('/dashboard/api/vardash/repos/:repoId/default-selections', async (c) => {
    const body = await readJson(c);
    const envKeyId = readString(body.envKeyId);
    if (!envKeyId) return c.json({ error: 'env_key_id_required' }, 400);
    const store = await getStore();
    await store.setRepoDefaultSelection({
      repoId: c.req.param('repoId'),
      envKeyId,
      savedValueId: readNullableString(body.savedValueId),
    });
    return c.json({ ok: true });
  });

  app.post('/dashboard/api/vardash/workspaces/:workspaceId/repos/:repoId/selections', async (c) => {
    const body = await readJson(c);
    const envKeyId = readString(body.envKeyId);
    if (!envKeyId) return c.json({ error: 'env_key_id_required' }, 400);
    const store = await getStore();
    await store.setWorkspaceRepoSelection({
      workspaceId: c.req.param('workspaceId'),
      repoId: c.req.param('repoId'),
      envKeyId,
      savedValueId: readNullableString(body.savedValueId),
    });
    return c.json({ ok: true, selectionSemantics: 'workspace-null-inherits-repo-default' });
  });

  app.get('/dashboard/api/vardash/repos/:repoId/process-definitions', async (c) => {
    const store = await getStore();
    const processes = await store.listRepoProcessDefinitions(c.req.param('repoId'));
    return c.json({ processes });
  });

  app.post('/dashboard/api/vardash/repos/:repoId/process-definitions', async (c) => {
    const body = await readJson(c);
    const name = readString(body.name);
    const command = readString(body.command);
    if (!name) return c.json({ error: 'name_required' }, 400);
    if (!command) return c.json({ error: 'command_required' }, 400);
    try {
      const store = await getStore();
      const process = await store.upsertRepoProcessDefinition({
        repoId: c.req.param('repoId'),
        name,
        command,
        cwd: readNullableString(body.cwd),
        source: 'manual',
        isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
      });
      return c.json({ process });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 409);
    }
  });

  app.post('/dashboard/api/vardash/repos/:repoId/process-definitions/:processDefinitionId/default', async (c) => {
    try {
      const store = await getStore();
      const process = await store.setRepoProcessDefinitionDefault({
        repoId: c.req.param('repoId'),
        processDefinitionId: c.req.param('processDefinitionId'),
      });
      return c.json({ process });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  app.post('/dashboard/api/vardash/repos/:repoId/process-definitions/import-legacy-dev-server', async (c) => {
    const body = await readJson(c);
    const devServerScript = readString(body.dev_server_script);
    const store = await getStore();
    const process = await ensureLegacyDevServerProcessDefinition({
      store,
      repo: {
        id: c.req.param('repoId'),
        dev_server_script: devServerScript,
      },
    });
    return c.json({ process });
  });

  app.post('/dashboard/api/vardash/workspaces/:workspaceId/repos/:repoId/launch', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const repoId = c.req.param('repoId');
    try {
      await validateWorkspaceRepo(options, { workspaceId, repoId });
    } catch {
      return c.json({ error: 'workspace_repo_forbidden' }, 403);
    }

    const body = await readJson(c);
    const store = await getStore();
    try {
      const plan = await prepareVardashRepoProcessLaunch({
        store,
        workspaceId,
        repoId,
        processDefinitionId: readNullableString(body.processDefinitionId) ?? undefined,
        processName: readNullableString(body.processName) ?? undefined,
        baseEnv: options.launchBaseEnv,
        allowBaseEnvKeys: options.launchAllowBaseEnvKeys,
        useVarlock: body.useVarlock === true,
        varlockSchemaPath: readNullableString(body.varlockSchemaPath) ?? undefined,
        varlockBin: readNullableString(body.varlockBin) ?? undefined,
      });
      return c.json(launchRunner.launch(plan));
    } catch (error) {
      if (error instanceof VardashLaunchError && error.message.startsWith('No vardash process definition')) {
        return c.json({ error: 'process_not_found' }, 404);
      }
      return c.json({ error: 'launch_failed' }, 409);
    }
  });

  app.get('/dashboard/api/vardash/launches/:runId/status', async (c) => {
    try {
      const status = launchRunner.getStatus(c.req.param('runId'));
      await validateWorkspaceRepo(options, { workspaceId: status.workspaceId, repoId: status.repoId });
      return c.json(status);
    } catch (error) {
      if (error instanceof VardashLaunchError) return c.json({ error: 'launch_not_found' }, 404);
      return c.json({ error: 'workspace_repo_forbidden' }, 403);
    }
  });

  app.post('/dashboard/api/vardash/launches/:runId/stop', async (c) => {
    try {
      const status = launchRunner.getStatus(c.req.param('runId'));
      await validateWorkspaceRepo(options, { workspaceId: status.workspaceId, repoId: status.repoId });
      return c.json(launchRunner.stop(c.req.param('runId')));
    } catch (error) {
      if (error instanceof VardashLaunchError) return c.json({ error: 'launch_not_found' }, 404);
      return c.json({ error: 'workspace_repo_forbidden' }, 403);
    }
  });

  app.get('/dashboard/api/vardash/workspaces/:workspaceId/repos/:repoId/launch/readiness', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const repoId = c.req.param('repoId');
    try {
      await validateWorkspaceRepo(options, { workspaceId, repoId });
    } catch {
      return c.json({ error: 'workspace_repo_forbidden' }, 403);
    }

    const store = await getStore();
    try {
      const readiness = await getVardashLaunchReadiness({
        store,
        workspaceId,
        repoId,
        processDefinitionId: readNullableString(c.req.query('processDefinitionId')) ?? undefined,
        processName: readNullableString(c.req.query('processName')) ?? undefined,
        useVarlock: c.req.query('useVarlock') === 'true',
      });
      return c.json(readiness);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('No vardash process definition')) {
        return c.json({ error: 'process_not_found' }, 404);
      }
      return c.json({ error: 'readiness_failed' }, 409);
    }
  });

  app.get('/dashboard/api/vardash/workspaces/:workspaceId/repos/:repoId/process-definitions', async (c) => {
    const store = await getStore();
    const processes = await store.listWorkspaceRepoProcessDefinitions({
      workspaceId: c.req.param('workspaceId'),
      repoId: c.req.param('repoId'),
    });
    return c.json({ processes });
  });

  app.post('/dashboard/api/vardash/repos/:repoId/import', async (c) => {
    const body = await readJson(c);
    const content = readString(body.content);
    const source = readImportSource(body.source);
    if (content == null) return c.json({ error: 'content_required' }, 400);
    if (!source) return c.json({ error: 'source_required' }, 400);

    const store = await getStore();
    const savedValueName = readString(body.savedValueName) ?? 'imported';
    const plainKeys = readStringArray(body.plainKeys);
    const preflight = await preflightImport({
      store,
      repoId: c.req.param('repoId'),
      content,
      source,
      plainKeys,
      savedValueName,
    });
    if (body.dryRun === true) return c.json(preflight);
    if (preflight.conflicts.length > 0) return c.json(preflight, 409);

    const result = await importVardashEnv({
      store,
      repoId: c.req.param('repoId'),
      content,
      source,
      plainKeys,
      savedValueName,
    });
    return c.json({ ...preflight, keys: result.keys, savedValues: result.savedValues });
  });
}

export async function preflightImport(input: {
  store: VardashStore;
  repoId: string;
  content: string;
  source: VardashEnvImportSource;
  plainKeys?: string[];
  savedValueName: string;
}): Promise<{
  dryRun: true;
  keys: Array<{ key: string; kind: VardashValueKind; required: true; willCreateSavedValue: boolean }>;
  diagnostics: ReturnType<typeof parseDotenv>['diagnostics'];
  conflicts: VardashImportConflict[];
}> {
  const parsed = parseDotenv(input.content);
  const plainKeys = new Set(input.plainKeys ?? []);
  const conflicts: VardashImportConflict[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    if (seen.has(entry.key)) conflicts.push({ key: entry.key, reason: 'duplicate_key_in_import' });
    seen.add(entry.key);
  }

  const existingKeys = await input.store.listRepoEnvKeys(input.repoId);
  for (const entry of parsed.entries) {
    const existingKey = existingKeys.find((key) => key.key === entry.key);
    if (!existingKey) continue;
    const values = await input.store.listSavedValues(input.repoId, existingKey.id);
    const nextKind: VardashValueKind = plainKeys.has(entry.key) ? 'plain' : 'secret';
    if (existingKey.kind === 'secret' && nextKind === 'plain' && values.length > 0) {
      conflicts.push({ key: entry.key, reason: 'secret_to_plain_with_existing_values' });
    }
    if (input.source === 'pasted-env') {
      if (values.some((value) => value.name === input.savedValueName)) {
        conflicts.push({
          key: entry.key,
          reason: 'saved_value_name_exists',
          savedValueName: input.savedValueName,
        });
      }
    }
  }

  return {
    dryRun: true,
    keys: parsed.entries.map((entry) => ({
      key: entry.key,
      kind: plainKeys.has(entry.key) ? 'plain' : 'secret',
      required: true,
      willCreateSavedValue: input.source === 'pasted-env',
    })),
    diagnostics: parsed.diagnostics,
    conflicts,
  };
}

async function validateWorkspaceRepo(
  options: RegisterVardashRoutesOptions,
  input: VardashWorkspaceRepoValidationInput,
): Promise<void> {
  if (options.validateWorkspaceRepo) {
    await options.validateWorkspaceRepo(input);
    return;
  }
  const client = new VibeKanbanServerClient();
  const workspaces = await client.getWorkspaces();
  if (!workspaces.some((workspace) => workspace.id === input.workspaceId)) {
    throw new Error('workspace_not_found');
  }
  const repos = await client.getWorkspaceRepos(input.workspaceId);
  if (!repos.some((repo) => repo.id === input.repoId)) {
    throw new Error('repo_not_in_workspace');
  }
}

function memoizeStore(options: RegisterVardashRoutesOptions): () => Promise<VardashStore> {
  let store: VardashStore | null = options.store ?? null;
  return async () => {
    if (store) return store;
    const privateDir = options.privateDir ?? defaultVardashPrivateDir();
    store = new SqlcipherVardashStore({
      dbPath: options.dbPath ?? join(privateDir, 'vardash.db'),
      keyOptions: { privateDir },
    });
    await store.migrate();
    return store;
  };
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  return await c.req.json().catch(() => ({})) as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableString(value: unknown): string | null {
  return value == null ? null : readString(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readKind(value: unknown): VardashValueKind | null {
  return value === 'secret' || value === 'plain' ? value : null;
}

function readImportSource(value: unknown): VardashEnvImportSource | null {
  return value === 'pasted-env' || value === 'sample-template' ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
