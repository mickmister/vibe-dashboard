import { describe, expect, it, vi } from 'vitest';
import { loadPanelTargetBackendAuthority, type AuthorityWorkspace } from './panelTargetBackendAuthority';

const workspace = { id: 'workspace-1' } as AuthorityWorkspace;
function client(overrides: Record<string, unknown> = {}) {
  return {
    getSessions: vi.fn(async () => []),
    getRunConfigs: vi.fn(async () => ({ run_configs: [], preview_slots: [], preview_url_parts: [] })),
    getPreviewSlotUrl: vi.fn(),
    ...overrides,
  } as never;
}

describe('backend Panel target owners', () => {
  it('distinguishes successful ready-empty terminal/session/preview owners', async () => {
    await expect(loadPanelTargetBackendAuthority(client(), [workspace])).resolves.toEqual({
      status: 'ready', definitions: { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {} },
    });
  });

  it('copies exact identities and excludes removed, unavailable, cross-workspace, and mismatched definitions', async () => {
    const getPreviewSlotUrl = vi.fn(async () => ({ previewSlotId: 'wrong', url: 'https://preview.test/' }));
    const snapshot = await loadPanelTargetBackendAuthority(client({
      getSessions: vi.fn(async () => [
        { id: 'cross', workspace_id: 'other', panel_target: { location: 'https://dashboard.test/cross', available: true, factoryKey: 'session' } },
        { id: 'session', workspace_id: 'workspace-1', panel_target: { location: 'https://dashboard.test/session', available: true, factoryKey: 'session' }, terminal_target: { terminalId: 'terminal', location: 'https://dashboard.test/terminal', available: false, factoryKey: 'terminal' } },
      ]),
      getRunConfigs: vi.fn(async () => ({ run_configs: [], preview_slots: [], preview_url_parts: [{ previewSlotId: 'preview', customerSlug: 'customer', factoryKey: 'preview-slot', allowedCraftIds: ['craft-1'] }] })),
      getPreviewSlotUrl,
    }), [workspace]);
    expect(snapshot).toMatchObject({ status: 'ready', definitions: { agentSessions: { session: { workspaceId: 'workspace-1' } }, terminals: {}, previews: {} } });
    expect(getPreviewSlotUrl).toHaveBeenCalledWith('workspace-1', 'preview', { customerSlug: 'customer', baseDomain: undefined });
  });

  it('propagates owner readiness failures instead of converting them to empty', async () => {
    await expect(loadPanelTargetBackendAuthority(client({ getSessions: vi.fn(async () => { throw new Error('session owner unavailable'); }) }), [workspace]))
      .rejects.toThrow('session owner unavailable');
  });
});
