import { Orientation, type SerializedDockview } from 'dockview';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { VoyageAggregate, VoyagePanelRecord } from '../store/voyageRepository';

const voyageId = 'm3-2-harness-voyage';
const workspaceId = 'workspace-a';

export function createDockviewM32HarnessAggregate(): VoyageAggregate {
  const ids = ['panel-a', 'panel-b', 'panel-c'];
  return {
    id: voyageId,
    revision: 0,
    activationSequence: 0,
    historyCursorSequence: 0,
    metadata: {
      name: 'M3.2 harness Voyage',
      mission: null,
      lifecycleState: 'active',
      lastOpenedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    crafts: [{ craftWorkspaceId: workspaceId, sortKey: 'a' }],
    panels: ids.map(panel),
    layout: productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot(ids)),
    history: [],
  };
}

function panel(id: string): VoyagePanelRecord {
  return {
    id,
    craftWorkspaceId: workspaceId,
    targetKind: 'craft-overview',
    targetVersion: 1,
    targetPayload: { workspaceId },
    titleMode: 'automatic',
    customTitle: null,
    closePolicy: 'closable',
    lastActivatedSequence: null,
  };
}

function snapshot(ids: string[], activePanelId = ids[0]): SerializedDockview {
  return {
    grid: {
      root: {
        type: 'branch',
        data: ids.map((id) => ({ type: 'leaf', data: { id: `group-${id}`, views: [id], activeView: id } })),
      },
      width: 1000,
      height: 800,
      orientation: Orientation.HORIZONTAL,
    },
    panels: Object.fromEntries(ids.map((id) => [id, { id, contentComponent: 'iframe-panel', renderer: 'always', params: { panelId: id } }])),
    ...(activePanelId ? { activeGroup: `group-${activePanelId}` } : {}),
  };
}
