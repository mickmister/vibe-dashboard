import { describe, expect, it } from 'vitest';
import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import { buildPreviewDeepLinkPath, resolvePreviewDeepLinkTarget } from './previewDeepLink';

const previewTab = {
  id: 'craft-surface:tg_target:preview',
  title: 'PreviewServer',
  url: '/preview',
  pinned: true,
  ephemeral: {
    kind: 'craft-surface' as const,
    pluginId: 'dev.mickmister.preview-server',
    surfaceKey: 'dev.mickmister.preview-server/run-configs',
    sourceKey: 'run-configs',
  },
};

function workspace(): WorkspaceState {
  return {
    nextId: 3,
    spaces: [{ id: 'space', name: 'Main', icon: '🚀', tabGroupIds: ['tg_other', 'tg_target'] }],
    tabGroups: [{
      id: 'tg_other', label: 'Other', tabs: [], pairs: [], order: 0, createdAt: '',
      workspace: { workspaceId: 'ws-other', workspaceDir: '/other' },
    }, {
      id: 'tg_target', label: 'Target', tabs: [previewTab], pairs: [], order: 1, createdAt: '',
      workspace: { workspaceId: 'ws-target', workspaceDir: '/target' },
    }],
  };
}

function voyage(id: string, tabGroupId: string): SavedWorkspaceSession {
  return {
    id, slug: '', name: id === 'voyage-target' ? 'Target Voyage' : 'Other Voyage',
    activeSpaceId: 'space', activeTabGroupId: tabGroupId,
    activeVoyageEntryId: `ve_${tabGroupId}`,
    activeItemsByVoyageEntryId: { [`ve_${tabGroupId}`]: 'agent' },
    voyageEntries: [{ id: `ve_${tabGroupId}`, tabGroupId, viewIds: ['agent'] }],
    visitedTabGroupIds: [tabGroupId], createdAt: '', updatedAt: '',
  };
}

describe('resolvePreviewDeepLinkTarget', () => {
  it('targets a PreviewServer surface in another workspace and its containing Voyage', () => {
    const other = voyage('voyage-other', 'tg_other');
    const target = voyage('voyage-target', 'tg_target');

    expect(resolvePreviewDeepLinkTarget({
      workspace: workspace(), savedSessions: [other, target], activeSession: other,
      previewWorkspaceId: 'ws-target', previewSlotId: 'slot-1',
    })).toEqual({
      spaceId: 'space', tabGroupId: 'tg_target', tabId: previewTab.id,
      session: target, voyageEntryId: 've_tg_target',
    });
  });

  it('builds a canonical cross-workspace runtime URL while preserving preview identity', () => {
    const other = voyage('voyage-other', 'tg_other');
    const targetSession = voyage('voyage-target', 'tg_target');
    const effectiveWorkspace = workspace();
    const target = resolvePreviewDeepLinkTarget({
      workspace: effectiveWorkspace, savedSessions: [other, targetSession], activeSession: other,
      previewWorkspaceId: 'ws-target', previewSlotId: 'slot-1',
    });
    expect(target).not.toBeNull();

    const path = buildPreviewDeepLinkPath({
      currentSearch: '?voyage=other-voyage&previewWorkspaceId=ws-target&previewSlotId=slot-1',
      workspace: effectiveWorkspace,
      savedSessions: [other, targetSession],
      target: target!,
      session: targetSession,
      voyageEntryId: 've_tg_target',
    });
    const params = new URL(path, 'https://dashboard.local').searchParams;
    expect(params.get('voyage')).toBe('target-voyage-target');
    expect(params.get('craft')).toBeTruthy();
    expect(params.get('views')).toBe('runtime:dev.mickmister.preview-server/run-configs');
    expect(params.get('previewWorkspaceId')).toBe('ws-target');
    expect(params.get('previewSlotId')).toBe('slot-1');
  });

  it('returns the active Voyage as an insertion target when the workspace craft is not yet in a Voyage', () => {
    const active = voyage('voyage-other', 'tg_other');
    const result = resolvePreviewDeepLinkTarget({
      workspace: workspace(), savedSessions: [active], activeSession: active,
      previewWorkspaceId: 'ws-target', previewSlotId: 'slot-1',
    });

    expect(result).toMatchObject({
      spaceId: 'space', tabGroupId: 'tg_target', tabId: previewTab.id,
      session: active,
    });
    expect(result?.voyageEntryId).toBeUndefined();
  });

  it('fails closed for incomplete, unknown, or non-PreviewServer targets', () => {
    const active = voyage('voyage-other', 'tg_other');
    const input = { workspace: workspace(), savedSessions: [active], activeSession: active };
    expect(resolvePreviewDeepLinkTarget({ ...input, previewWorkspaceId: null, previewSlotId: 'slot-1' })).toBeNull();
    expect(resolvePreviewDeepLinkTarget({ ...input, previewWorkspaceId: 'ws-target', previewSlotId: null })).toBeNull();
    expect(resolvePreviewDeepLinkTarget({ ...input, previewWorkspaceId: 'missing', previewSlotId: 'slot-1' })).toBeNull();
  });
});
