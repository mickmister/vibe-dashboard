import { describe, expect, it, vi } from 'vitest';
import { loadPanelTargetBackendAuthority } from './panelTargetBackendAuthority';
import type { PanelTargetDeliveryGuardOwner } from './panelTargetRouterAuthority';

function client(overrides: Record<string, unknown> = {}) {
  return {
    getPanelTargetAuthority: vi.fn(async () => ({ ready: true, workspaceId: 'workspace-1', workspaceTargets: {}, sessions: [], terminalsReady: true, terminals: [], previews: [] })),
    getPreviewSlotUrl: vi.fn(async () => ({ previewSlotId: 'preview', url: 'https://preview.test/' })),
    ...overrides,
  } as never;
}

describe('backend Panel target owners', () => {
  const routes: PanelTargetDeliveryGuardOwner = {
    isCurrent: () => true,
    issueWorkspace: (kind, workspaceId, applicationOrigin) => ({ location: `https://vk.test/workspaces/${workspaceId}${kind === 'code' ? '/vscode' : ''}`, guard: { deliveryUrl: `${applicationOrigin}/w/${workspaceId}/${kind}`, upstreamOrigin: 'https://vk.test' } }),
    issuePreview: async (workspaceId, previewId, applicationOrigin) => ({ location: 'https://preview.test/', guard: { deliveryUrl: `${applicationOrigin}/p/${workspaceId}/${previewId}`, upstreamOrigin: 'https://preview.test' } }),
  };
  it('distinguishes successful ready-empty terminal/session/preview owners', async () => {
    await expect(loadPanelTargetBackendAuthority(client(), ['workspace-1'], routes, 'https://dashboard.test')).resolves.toEqual({
      status: 'ready', definitions: { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {}, workspaceTargets: { 'workspace-1': {} } },
    });
  });

  it('copies exact identities and excludes removed, unavailable, cross-workspace, and mismatched definitions', async () => {
    const getPreviewSlotUrl = vi.fn(async () => ({ previewSlotId: 'preview', url: 'https://preview.test/' }));
    const snapshot = await loadPanelTargetBackendAuthority(client({
      getPanelTargetAuthority: vi.fn(async () => ({ ready: true, workspaceId: 'workspace-1', workspaceTargets: {}, terminalsReady: true, terminals: [
        { terminalId: 'terminal', workspaceId: 'workspace-1', factory: { available: true, factoryKey: 'terminal' } },
      ], sessions: [
        { sessionId: 'cross', workspaceId: 'other', factory: { available: true, factoryKey: 'session' } },
        { sessionId: 'session', workspaceId: 'workspace-1', factory: { available: true, factoryKey: 'session' } },
      ], previews: [{ previewSlotId: 'preview', workspaceId: 'workspace-1', factoryKey: 'preview-slot', available: true }] })),
    }), ['workspace-1'], routes, 'https://dashboard.test');
    expect(snapshot).toMatchObject({ status: 'ready', definitions: { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {} } });
  });

  it('publishes exact guards for ambient workspace targets and rejects unresolved preview delivery', async () => {
    const result = await loadPanelTargetBackendAuthority(client({
      getPanelTargetAuthority: vi.fn(async () => ({ ready: true, workspaceId: 'workspace-1', terminalsReady: true, terminals: [], sessions: [], previews: [{ previewSlotId: 'preview', workspaceId: 'workspace-1', factoryKey: 'preview-slot', available: true }], workspaceTargets: { code: { available: true, factoryKey: 'code' } } })),
    }), ['workspace-1'], { ...routes, issuePreview: async () => null }, 'https://dashboard.test');
    expect(result).toMatchObject({ status: 'ready', definitions: { previews: {}, redirectGuards: {
      'code:workspace-1': { deliveryUrl: 'https://dashboard.test/w/workspace-1/code', upstreamOrigin: 'https://vk.test' },
    } } });
  });

  it('propagates owner readiness failures instead of converting them to empty', async () => {
    await expect(loadPanelTargetBackendAuthority(client({ getPanelTargetAuthority: vi.fn(async () => { throw new Error('session owner unavailable'); }) }), ['workspace-1'], routes, 'https://dashboard.test'))
      .rejects.toThrow('session owner unavailable');
  });
});
