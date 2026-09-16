import { describe, expect, it, vi } from 'vitest';
import { resolvePanelTarget, type CapabilityDescriptor, type PanelTarget, type TrustedTargetRegistry } from './targetRegistry';
import { SurfaceOpeningCoordinator, type DurablePanel, type VoyageState } from './surfaceOpeningCoordinator';

const capabilities: CapabilityDescriptor = { sandbox: ['allow-scripts'], clipboardRead: false, clipboardWrite: false, sameOrigin: false, navigation: 'resolved-origin' };
const target = (surfaceKey: string, workspaceId = 'workspace-1'): PanelTarget => ({ version: 1, kind: 'workspace-surface', workspaceId, surfaceKey });

function registry(): TrustedTargetRegistry {
  const definition = (surfaceKey: string) => ({ resolve: (context: { craftId: string; workspaceId?: string }) => ({
    rendererKey: `renderer:${surfaceKey}`, payload: {}, provenance: 'built-in' as const, capabilities,
    runtime: { kind: 'leaseable-runtime' as const }, splitCompatibility: ['workbench'],
    equivalenceInputs: [surfaceKey, context.workspaceId!], sharingInputs: [surfaceKey, context.workspaceId!],
  }) });
  return {
    crafts: {
      craft: { workspaceId: 'workspace-1', allowedScopes: ['agent', 'code', 'forms'] },
      other: { workspaceId: 'workspace-2', allowedScopes: ['agent', 'code'] },
    },
    workspaces: { 'workspace-1': { available: true, containerRef: '/one' }, 'workspace-2': { available: true, containerRef: '/two' } },
    surfaces: { agent: definition('agent'), code: definition('code'), forms: definition('forms') },
    internalRoutes: {}, installedPlugins: new Set(), factories: {}, customUrl: definition('custom'),
  };
}

function panel(id: string, voyageId: string, craftId: string, surfaceKey: string, groupId: string, sequence: number | null, workspaceId = 'workspace-1'): DurablePanel {
  return { id, voyageId, craftId, target: target(surfaceKey, workspaceId), equivalenceKey: `${surfaceKey}:${workspaceId}`, groupId, lastActivatedSequence: sequence, runtimeId: `runtime:${id}` };
}

function voyage(id = 'voyage-1', width = 1000): VoyageState {
  const agent = panel('agent', id, 'craft', 'agent', 'agent-group', 1);
  return { id, width, revision: 0, activationSequence: 1, historyCheckpointCount: 0, panels: { agent }, groups: [{ id: 'agent-group', panelIds: ['agent'], activePanelId: 'agent', widthRatio: 1 }], maximizedGroupId: null };
}

function setup(states = [voyage()]) {
  const trusted = registry();
  const compareAndSwap = vi.fn(() => true);
  const checkpoint = vi.fn();
  return {
    coordinator: new SurfaceOpeningCoordinator(states, {
      resolve: (value, craftId) => resolvePanelTarget(value, { craftId }, trusted), compareAndSwap, checkpoint,
    }), compareAndSwap, checkpoint,
  };
}

describe('generic durable surface opening coordinator', () => {
  it('creates one trusted target immediately right at 50/50 and supports a non-Code target', async () => {
    const { coordinator, checkpoint } = setup();
    const result = await coordinator.open({ voyageId: 'voyage-1', invokingPanelId: 'agent', craftId: 'craft', target: target('forms'), intent: 'beside' });
    const state = coordinator.state('voyage-1');
    expect(result).toMatchObject({ created: true, moved: false, focusedOnly: false, revision: 1 });
    expect(state.groups.map(({ panelIds, widthRatio }) => ({ panelIds, widthRatio }))).toEqual([
      { panelIds: ['agent'], widthRatio: 0.5 }, { panelIds: [result.panelId], widthRatio: 0.5 },
    ]);
    expect(checkpoint).toHaveBeenCalledOnce();
  });

  it('prefers visible adjacency over a newer same-Voyage equivalent, then MRU and stable ID', async () => {
    const state = voyage();
    const adjacent = panel('code-adjacent', state.id, 'craft', 'code', 'right', 2);
    const newer = panel('code-newer', state.id, 'craft', 'code', 'far', 9);
    state.panels = { ...state.panels, [adjacent.id]: adjacent, [newer.id]: newer };
    state.groups.push(
      { id: 'right', panelIds: [adjacent.id], activePanelId: adjacent.id, widthRatio: 0.3 },
      { id: 'far', panelIds: [newer.id], activePanelId: newer.id, widthRatio: 0.2 },
    );
    const { coordinator, checkpoint } = setup([state]);
    const adjacentResult = await coordinator.open({ voyageId: state.id, invokingPanelId: 'agent', craftId: 'craft', target: target('code'), intent: 'beside' });
    expect(adjacentResult).toMatchObject({ panelId: adjacent.id, focusedOnly: true });
    expect(checkpoint).not.toHaveBeenCalled();

    const withoutAdjacency = coordinator.state(state.id);
    withoutAdjacency.groups.splice(1, 0, { id: 'spacer', panelIds: [], activePanelId: '', widthRatio: 0.1 });
    const equalA = withoutAdjacency.panels[adjacent.id]!;
    equalA.lastActivatedSequence = 9;
    const { coordinator: mruCoordinator } = setup([withoutAdjacency]);
    const mruResult = await mruCoordinator.open({ voyageId: state.id, invokingPanelId: 'agent', craftId: 'craft', target: target('code'), intent: 'beside' });
    expect(mruResult.panelId).toBe('code-adjacent');
    expect(mruResult.moved).toBe(true);
  });

  it('never imports equivalents from another Voyage and dedupes concurrent creation', async () => {
    const other = voyage('voyage-2');
    const foreign = panel('foreign-code', other.id, 'craft', 'code', 'foreign-group', 99);
    other.panels[foreign.id] = foreign;
    other.groups.push({ id: 'foreign-group', panelIds: [foreign.id], activePanelId: foreign.id, widthRatio: 0.5 });
    const { coordinator, checkpoint } = setup([voyage(), other]);
    const input = { voyageId: 'voyage-1', invokingPanelId: 'agent', craftId: 'craft', target: target('code'), intent: 'beside' as const };
    const results = await Promise.all([coordinator.open(input), coordinator.open(input), coordinator.open(input)]);
    expect(new Set(results.map(({ panelId }) => panelId)).size).toBe(1);
    expect(Object.values(coordinator.state('voyage-1').panels).filter(({ equivalenceKey }) => equivalenceKey === 'code:workspace-1')).toHaveLength(1);
    expect(coordinator.state('voyage-2').panels['foreign-code']).toEqual(foreign);
    expect(checkpoint).toHaveBeenCalledOnce();
  });

  it('uses a tab fallback on narrow width and rolls back state on CAS failure', async () => {
    const narrow = setup([voyage('voyage-1', 500)]);
    const result = await narrow.coordinator.open({ voyageId: 'voyage-1', invokingPanelId: 'agent', craftId: 'craft', target: target('forms'), intent: 'beside' });
    expect(narrow.coordinator.state('voyage-1').groups).toHaveLength(1);
    expect(narrow.coordinator.state('voyage-1').groups[0]).toMatchObject({ panelIds: ['agent', result.panelId], activePanelId: result.panelId });

    const trusted = registry();
    const coordinator = new SurfaceOpeningCoordinator([voyage()], { resolve: (value, craftId) => resolvePanelTarget(value, { craftId }, trusted), compareAndSwap: () => false, checkpoint: vi.fn() });
    await expect(coordinator.open({ voyageId: 'voyage-1', invokingPanelId: 'agent', craftId: 'craft', target: target('code'), intent: 'beside' })).rejects.toThrow('revision-conflict');
    expect(coordinator.state('voyage-1')).toEqual(voyage());
  });

  it('maximizes an existing target in place and creates/activates an absent target in one checkpoint', async () => {
    const state = voyage();
    const forms = panel('forms', state.id, 'craft', 'forms', 'forms-group', 2);
    state.panels.forms = forms;
    state.groups.push({ id: 'forms-group', panelIds: ['forms'], activePanelId: 'forms', widthRatio: 0.5 });
    const existing = setup([state]);
    const result = await existing.coordinator.open({ voyageId: state.id, invokingPanelId: 'agent', craftId: 'craft', target: target('forms'), intent: 'maximized' });
    expect(result).toMatchObject({ panelId: 'forms', created: false, moved: false });
    expect(existing.coordinator.state(state.id)).toMatchObject({ maximizedGroupId: 'forms-group', revision: 1, historyCheckpointCount: 1 });
    expect(existing.checkpoint).toHaveBeenCalledOnce();

    const absent = setup();
    const created = await absent.coordinator.open({ voyageId: 'voyage-1', invokingPanelId: 'agent', craftId: 'craft', target: target('code'), intent: 'maximized' });
    const createdState = absent.coordinator.state('voyage-1');
    expect(created.created).toBe(true);
    expect(createdState.groups).toHaveLength(1);
    expect(createdState.groups[0]!.activePanelId).toBe(created.panelId);
    expect(createdState.maximizedGroupId).toBe('agent-group');
    expect(absent.checkpoint).toHaveBeenCalledOnce();
  });

  it('keeps activation recency outside structural history snapshots', async () => {
    const state = voyage();
    const code = panel('code', state.id, 'craft', 'code', 'code-group', 7);
    state.panels.code = code;
    state.groups.push({ id: 'code-group', panelIds: ['code'], activePanelId: 'code', widthRatio: 0.5 });
    const { coordinator, checkpoint } = setup([state]);
    await coordinator.open({ voyageId: state.id, invokingPanelId: 'agent', craftId: 'craft', target: target('code'), intent: 'maximized' });
    const [, before, after] = checkpoint.mock.calls[0]!;
    expect(JSON.stringify(before)).not.toContain('lastActivatedSequence');
    expect(JSON.stringify(after)).not.toContain('lastActivatedSequence');
    expect(coordinator.state(state.id).panels.code!.lastActivatedSequence).toBe(2);
  });
});
