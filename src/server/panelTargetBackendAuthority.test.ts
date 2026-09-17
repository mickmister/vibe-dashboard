import { describe, expect, it, vi } from 'vitest';
import { loadPanelTargetBackendAuthority } from './panelTargetBackendAuthority';

function client(overrides: Record<string, unknown> = {}) {
  return {
    getPanelTargetAuthority: vi.fn(async () => ({ ready: true, workspaceId: 'workspace-1', workspaceTargets: {}, sessions: [], terminalsReady: true, terminals: [], previews: [] })),
    getPreviewSlotUrl: vi.fn(),
    ...overrides,
  } as never;
}

describe('backend Panel target owners', () => {
  it('distinguishes successful ready-empty terminal/session/preview owners', async () => {
    await expect(loadPanelTargetBackendAuthority(client(), ['workspace-1'])).resolves.toEqual({
      status: 'ready', definitions: { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {}, workspaceTargets: { 'workspace-1': {} } },
    });
  });

  it('copies exact identities and excludes removed, unavailable, cross-workspace, and mismatched definitions', async () => {
    const getPreviewSlotUrl = vi.fn(async () => ({ previewSlotId: 'wrong', url: 'https://preview.test/' }));
    const snapshot = await loadPanelTargetBackendAuthority(client({
      getPanelTargetAuthority: vi.fn(async () => ({ ready: true, workspaceId: 'workspace-1', workspaceTargets: {}, terminalsReady: true, terminals: [
        { terminalId: 'terminal', workspaceId: 'workspace-1', delivery: { location: '/terminal', available: true, factoryKey: 'terminal' } },
      ], sessions: [
        { sessionId: 'cross', workspaceId: 'other', delivery: { location: '/cross', available: true, factoryKey: 'session' } },
        { sessionId: 'session', workspaceId: 'workspace-1', delivery: { location: '/session', available: true, factoryKey: 'session' } },
      ], previews: [{ previewSlotId: 'preview', workspaceId: 'workspace-1', urlParts: { previewSlotId: 'preview', workspaceToken: 'token', repoSlug: 'repo', slotSlug: 'slot' }, customerSlug: 'customer', factoryKey: 'preview-slot', available: true }] })),
      getPreviewSlotUrl,
    }), ['workspace-1']);
    expect(snapshot).toMatchObject({ status: 'ready', definitions: { agentSessions: { session: { workspaceId: 'workspace-1' } }, terminals: { terminal: { workspaceId: 'workspace-1', location: '/terminal' } }, previews: {} } });
    expect(getPreviewSlotUrl).toHaveBeenCalledWith('workspace-1', 'preview', { customerSlug: 'customer' });
  });

  it('propagates owner readiness failures instead of converting them to empty', async () => {
    await expect(loadPanelTargetBackendAuthority(client({ getPanelTargetAuthority: vi.fn(async () => { throw new Error('session owner unavailable'); }) }), ['workspace-1']))
      .rejects.toThrow('session owner unavailable');
  });
});
