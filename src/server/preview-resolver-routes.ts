import type { Hono } from 'hono';
import {
  VibeKanbanServerClient,
  type PreviewResolveRequest,
  type PreviewResolveResponse,
} from './vk-client';

export interface RegisterPreviewResolverRoutesOptions {
  vkClient?: Pick<VibeKanbanServerClient, 'resolvePreview'>;
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

export function registerPreviewResolverRoutes(
  app: Hono,
  options: RegisterPreviewResolverRoutesOptions = {},
): void {
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();

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
  };
}
