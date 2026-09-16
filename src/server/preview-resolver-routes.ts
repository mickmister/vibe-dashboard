import type { Hono } from 'hono';
import {
  VibeKanbanServerClient,
  type PreviewSlot,
  type PreviewSlotUrlResponse,
  type PreviewResolveRequest,
  type PreviewResolveResponse,
  type RepoWithBranch,
  type RunConfig,
  type RunConfigStartResponse,
  type UpsertPreviewSlot,
  type UpsertRunConfig,
  type WorkspaceRunConfigsResponse,
} from './vk-client';

export interface RegisterPreviewResolverRoutesOptions {
  vkClient?: Pick<VibeKanbanServerClient, 'resolvePreview'> & Partial<Pick<
    VibeKanbanServerClient,
    | 'getRunConfigs'
    | 'getWorkspaceRepos'
    | 'getExecutionProcess'
    | 'getSession'
    | 'upsertRunConfig'
    | 'upsertPreviewSlot'
    | 'startRunConfig'
    | 'startPreviewSlot'
    | 'getPreviewSlotUrl'
    | 'fetchRawExecutionLogs'
  >>;
}

const VALID_RESOLVE_STATUSES = new Set([
  'ready',
  'starting',
  'not_found',
  'capacity_full',
  'failed',
  'unavailable',
  'error',
]);
const STARTED_PREVIEW_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STARTED_PREVIEW_LINKS = 1_000;

export function registerPreviewResolverRoutes(
  app: Hono,
  options: RegisterPreviewResolverRoutesOptions = {},
): void {
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();
  const startedPreviewLinks = new Map<string, { workspaceId: string; expiresAt: number }>();

  const rememberStartedPreviewLink = (workspaceId: string, response: RunConfigStartResponse) => {
    const link = response.preview_process_link;
    if (link.workspace_id !== workspaceId || !link.execution_process_id) return;
    const now = Date.now();
    for (const [processId, cached] of startedPreviewLinks) {
      if (cached.expiresAt <= now) startedPreviewLinks.delete(processId);
    }
    while (startedPreviewLinks.size >= MAX_STARTED_PREVIEW_LINKS) {
      const oldestProcessId = startedPreviewLinks.keys().next().value as string | undefined;
      if (!oldestProcessId) break;
      startedPreviewLinks.delete(oldestProcessId);
    }
    startedPreviewLinks.set(link.execution_process_id, {
      workspaceId,
      expiresAt: now + STARTED_PREVIEW_LINK_TTL_MS,
    });
  };

  app.post('/internal/preview/resolve', async (c) => {
    let payload: PreviewResolveRequest;
    try {
      payload = await c.req.json<PreviewResolveRequest>();
    } catch {
      return c.json({ status: 'error', message: 'Invalid preview resolve JSON' }, 400);
    }

    const validationError = validatePreviewResolveRequest(payload);
    if (validationError) {
      return c.json({ status: 'not_found', message: validationError }, 200);
    }

    try {
      const response = await vkClient.resolvePreview(payload);
      return c.json(normalizeResolveResponse(response), 200);
    } catch (error) {
      console.warn('Preview resolver VK request failed', error);
      return c.json({ status: 'unavailable', message: 'Preview resolver backend is unavailable' }, 200);
    }
  });

  app.get('/internal/preview/workspaces/:workspaceId/run-configs', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    try {
      const response = await vkClient.getRunConfigs!(workspaceId);
      return c.json(response, 200);
    } catch (error) {
      console.warn('Preview run config list failed', error);
      return c.json({ message: 'Preview run config backend is unavailable' }, 502);
    }
  });

  app.get('/internal/preview/workspaces/:workspaceId/repos', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    try {
      const response: RepoWithBranch[] = await vkClient.getWorkspaceRepos!(workspaceId);
      return c.json(response, 200);
    } catch (error) {
      console.warn('Preview repo list failed', error);
      return c.json({ message: 'Preview repo backend is unavailable' }, 502);
    }
  });

  app.get('/internal/preview/workspaces/:workspaceId/execution-processes/:processId/logs', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const processId = c.req.param('processId');
    const timeoutMs = parseBoundedInteger(c.req.query('timeoutMs'), 1500, 100, 10_000);
    const maxEntries = parseBoundedInteger(c.req.query('maxEntries'), 200, 1, 1_000);
    try {
      const previewData = await vkClient.getRunConfigs!(workspaceId);
      const cachedLink = startedPreviewLinks.get(processId);
      if (cachedLink && cachedLink.expiresAt <= Date.now()) {
        startedPreviewLinks.delete(processId);
      }
      const linkedProcess = previewData.preview_process_links?.some(
        (link) => link.workspace_id === workspaceId && link.execution_process_id === processId,
      ) || (cachedLink?.workspaceId === workspaceId && cachedLink.expiresAt > Date.now());
      if (!linkedProcess) {
        return c.json({ message: 'No PreviewServer logs found for this workspace process.' }, 404);
      }
      const process = await vkClient.getExecutionProcess!(processId);
      const session = await vkClient.getSession!(process.session_id);
      if (session.workspace_id !== workspaceId) {
        return c.json({ message: 'No PreviewServer logs found for this workspace process.' }, 404);
      }
      const logs = await vkClient.fetchRawExecutionLogs!(processId, { timeoutMs, maxEntries });
      return c.json({ process_id: processId, logs }, 200);
    } catch (error) {
      console.warn('Preview process logs failed', error);
      return c.json({ message: error instanceof Error ? error.message : 'Preview process logs failed' }, 502);
    }
  });

  app.post('/internal/preview/workspaces/:workspaceId/run-configs', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const payload = await parseJson<UpsertRunConfig>(c.req.raw);
    if (!payload.ok) return c.json({ message: payload.message }, 400);
    try {
      const response = await vkClient.upsertRunConfig!(workspaceId, payload.value);
      return c.json(response, 200);
    } catch (error) {
      console.warn('Preview run config upsert failed', error);
      return c.json({ message: error instanceof Error ? error.message : 'Preview run config backend failed' }, 502);
    }
  });

  app.post('/internal/preview/workspaces/:workspaceId/preview-slots', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const payload = await parseJson<UpsertPreviewSlot>(c.req.raw);
    if (!payload.ok) return c.json({ message: payload.message }, 400);
    try {
      const response = await vkClient.upsertPreviewSlot!(workspaceId, payload.value);
      return c.json(response, 200);
    } catch (error) {
      console.warn('Preview slot upsert failed', error);
      return c.json({ message: error instanceof Error ? error.message : 'Preview slot backend failed' }, 502);
    }
  });

  app.post('/internal/preview/workspaces/:workspaceId/run-configs/:runConfigId/start', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const runConfigId = c.req.param('runConfigId');
    try {
      const response = await vkClient.startRunConfig!(workspaceId, runConfigId);
      rememberStartedPreviewLink(workspaceId, response);
      return c.json(response, 200);
    } catch (error) {
      console.warn('Preview run config start failed', error);
      return c.json({ message: error instanceof Error ? error.message : 'Preview run config start failed' }, 502);
    }
  });

  app.post('/internal/preview/workspaces/:workspaceId/preview-slots/:previewSlotId/start', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const previewSlotId = c.req.param('previewSlotId');
    try {
      const response = await vkClient.startPreviewSlot!(workspaceId, previewSlotId);
      rememberStartedPreviewLink(workspaceId, response);
      return c.json(response, 200);
    } catch (error) {
      console.warn('Preview slot start failed', error);
      return c.json({ message: error instanceof Error ? error.message : 'Preview slot start failed' }, 502);
    }
  });

  app.get('/internal/preview/workspaces/:workspaceId/preview-slots/:previewSlotId/url', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const previewSlotId = c.req.param('previewSlotId');
    const customerSlug = c.req.query('customerSlug') || '';
    const baseDomain = c.req.query('baseDomain') || undefined;
    const localOrigin = c.req.query('localOrigin') || undefined;
    try {
      const response = await vkClient.getPreviewSlotUrl!(workspaceId, previewSlotId, { customerSlug, baseDomain });
      return c.json(
        rewritePreviewUrlForLocalCaddy(response, { baseDomain, localOrigin }),
        200,
      );
    } catch (error) {
      console.warn('Preview slot URL generation failed', error);
      return c.json({ message: error instanceof Error ? error.message : 'Preview slot URL generation failed' }, 502);
    }
  });
}

function rewritePreviewUrlForLocalCaddy(
  response: PreviewSlotUrlResponse,
  options: { baseDomain?: string; localOrigin?: string },
): PreviewSlotUrlResponse {
  if (options.baseDomain !== 'localhost' || !options.localOrigin) {
    return response;
  }

  let origin: URL;
  try {
    origin = new URL(options.localOrigin);
  } catch {
    return response;
  }

  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== 'localhost' ||
    !origin.port ||
    !response.host.endsWith('.localhost')
  ) {
    return response;
  }

  return {
    ...response,
    url: `http://${response.host}:${origin.port}/`,
  };
}

async function parseJson<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await request.json() as T };
  } catch {
    return { ok: false, message: 'Invalid JSON body' };
  }
}

function validatePreviewResolveRequest(payload: PreviewResolveRequest): string | null {
  if (!/^[a-f0-9]{16}$/.test(payload.workspaceToken)) {
    return 'Invalid preview workspace token';
  }
  if (!/^[a-z0-9]{1,18}$/.test(payload.repoSlug)) {
    return 'Invalid preview repo slug';
  }
  if (!/^[a-z0-9]{1,10}$/.test(payload.slotSlug)) {
    return 'Invalid preview slot slug';
  }
  if (!/^[a-z0-9]{1,16}$/.test(payload.customerSlug)) {
    return 'Invalid preview customer slug';
  }
  return null;
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeResolveResponse(response: PreviewResolveResponse): PreviewResolveResponse {
  const status = String(response.status || '').toLowerCase() as PreviewResolveResponse['status'];
  if (!VALID_RESOLVE_STATUSES.has(status)) {
    return { status: 'error', message: 'Preview resolver backend returned an invalid status' };
  }
  return {
    status,
    upstream: response.upstream ?? undefined,
    message: response.message ?? undefined,
    executionProcessId: response.executionProcessId ?? undefined,
    workspaceId: response.workspaceId ?? undefined,
    previewSlotId: response.previewSlotId ?? undefined,
  };
}
