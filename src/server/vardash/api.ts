import { join } from 'node:path';
import type { Context, Hono } from 'hono';

import { defaultVardashPrivateDir } from './key-manager';
import { importVardashEnv, parseDotenv, type VardashEnvImportSource } from './import-parser';
import { SqlcipherVardashStore, type VardashStore, type VardashValueKind } from './store';

export interface RegisterVardashRoutesOptions {
  store?: VardashStore;
  dbPath?: string;
  privateDir?: string;
}

export interface VardashImportConflict {
  key: string;
  reason: 'duplicate_key_in_import' | 'saved_value_name_exists';
  savedValueName?: string;
}

export function registerVardashRoutes(app: Hono, options: RegisterVardashRoutesOptions = {}): void {
  const getStore = memoizeStore(options);

  app.get('/dashboard/api/vardash/repos/:repoId/env-keys', async (c) => {
    const store = await getStore();
    const keys = await store.listRepoEnvKeys(c.req.param('repoId'));
    return c.json({ keys });
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
      return c.json({ key: envKey });
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

  if (input.source === 'pasted-env') {
    const existingKeys = await input.store.listRepoEnvKeys(input.repoId);
    for (const entry of parsed.entries) {
      const existingKey = existingKeys.find((key) => key.key === entry.key);
      if (!existingKey) continue;
      const values = await input.store.listSavedValues(input.repoId, existingKey.id);
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
