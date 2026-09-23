import { Orientation, type SerializedDockview } from 'dockview';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { CommitLayoutMutationInput, VoyageAggregate, VoyagePanelRecord } from '../store/voyageRepository';

export const dockviewM32HarnessVoyageId = 'm3-2-harness-voyage';
export const dockviewM32HarnessWorkspaceId = 'workspace-a';
const allowedPanelIds = new Set(['panel-a', 'panel-b', 'panel-c', 'panel-d']);

export function createDockviewM32HarnessAggregate(): VoyageAggregate {
  const ids = ['panel-a', 'panel-b', 'panel-c'];
  return {
    id: dockviewM32HarnessVoyageId,
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
    crafts: [{ craftWorkspaceId: dockviewM32HarnessWorkspaceId, sortKey: 'a' }],
    panels: ids.map(panel),
    layout: productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot(ids)),
    history: [],
  };
}

export function assertDockviewM32HarnessVoyageId(voyageId?: string): asserts voyageId is typeof dockviewM32HarnessVoyageId {
  if (voyageId !== undefined && voyageId !== dockviewM32HarnessVoyageId) {
    throw new Error('DockView M3.2 harness action is restricted to the harness Voyage.');
  }
}

export function assertDockviewM32HarnessLayoutMutation(input: CommitLayoutMutationInput): void {
  assertDockviewM32HarnessVoyageId(input.voyageId);
  const ids = input.panels.map(({ id }) => id);
  if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !allowedPanelIds.has(id))) {
    throw new Error('DockView M3.2 harness action rejected non-fixture Panels.');
  }
  const expectedPanels = new Map(ids.map((id) => [id, panel(id)]));
  for (const record of input.panels) {
    const expected = expectedPanels.get(record.id);
    if (!expected
      || record.craftWorkspaceId !== expected.craftWorkspaceId
      || record.targetKind !== expected.targetKind
      || record.targetVersion !== expected.targetVersion
      || record.targetPayload.workspaceId !== dockviewM32HarnessWorkspaceId
      || record.titleMode !== expected.titleMode
      || record.customTitle !== expected.customTitle
      || record.closePolicy !== expected.closePolicy) {
      throw new Error('DockView M3.2 harness action rejected non-fixture Panels.');
    }
  }
  const snapshotPanelIds = productionDockviewSnapshotCodec.validateAndCanonicalize(input.snapshot).panelIds;
  const panelIds = new Set(ids);
  if (snapshotPanelIds.length !== panelIds.size || snapshotPanelIds.some((id) => !panelIds.has(id))) {
    throw new Error('DockView M3.2 harness action rejected non-fixture layout.');
  }
  if (input.activationPanelId && !panelIds.has(input.activationPanelId)) {
    throw new Error('DockView M3.2 harness action rejected non-fixture activation.');
  }
}

export function assertDockviewM32HarnessActivation(input: { voyageId: string; panelId: string }): void {
  assertDockviewM32HarnessVoyageId(input.voyageId);
  if (!allowedPanelIds.has(input.panelId)) {
    throw new Error('DockView M3.2 harness action rejected non-fixture activation.');
  }
}

function panel(id: string): VoyagePanelRecord {
  return {
    id,
    craftWorkspaceId: dockviewM32HarnessWorkspaceId,
    targetKind: 'craft-overview',
    targetVersion: 1,
    targetPayload: { workspaceId: dockviewM32HarnessWorkspaceId },
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
