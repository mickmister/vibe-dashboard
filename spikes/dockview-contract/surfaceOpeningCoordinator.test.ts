import { describe, expect, it, vi } from 'vitest';
import { resolvePanelTarget, type CapabilityDescriptor, type PanelTarget, type TrustedTargetRegistry } from './targetRegistry';
import { areVisiblyAdjacent, SurfaceOpeningCoordinator, structuralSnapshot, validateTopology, type AtomicCommit, type DurablePanel, type TrustedPanelResolution, type VoyageState } from './surfaceOpeningCoordinator';

const caps: CapabilityDescriptor = { sandbox: [], clipboardRead: false, clipboardWrite: false, sameOrigin: false, navigation: 'none' };
const target = (surfaceKey: string, workspaceId = 'w1'): PanelTarget => ({ version: 1, kind: 'workspace-surface', workspaceId, surfaceKey });
function registry(): TrustedTargetRegistry {
  const definition = (key: string) => ({ resolve: (context: { workspaceId?: string }) => ({ rendererKey: `r:${key}`, payload: {}, provenance: 'built-in' as const, capabilities: caps, runtime: { kind: 'leaseable-runtime' as const }, splitCompatibility: ['workbench'], equivalenceInputs: [key, context.workspaceId!], sharingInputs: [key, context.workspaceId!] }) });
  return { crafts: { craft: { workspaceId: 'w1', allowedScopes: ['agent', 'code', 'forms'] }, unrelated: { workspaceId: 'w2', allowedScopes: ['agent', 'code'] } }, workspaces: { w1: { available: true, containerRef: '/one' }, w2: { available: true, containerRef: '/two' } }, surfaces: { agent: definition('agent'), code: definition('code'), forms: definition('forms') }, internalRoutes: {}, installedPlugins: new Set(), factories: {}, customUrl: definition('url') };
}
function panel(id: string, surface: string, groupId: string, sequence: number | null, craftId = 'craft', workspaceId = 'w1'): DurablePanel { return { id, voyageId: 'voyage', craftId, target: target(surface, workspaceId), groupId, lastActivatedSequence: sequence, runtimeId: `runtime:${id}` }; }
function state(width = 900): VoyageState { return { id: 'voyage', width, revision: 0, activationSequence: 10, panels: { agent: panel('agent', 'agent', 'agent-group', 1) }, groups: [{ id: 'agent-group', panelIds: ['agent'], activePanelId: 'agent', rect: { x: 0, y: 0, width, height: 600 } }], maximizedGroupId: null, history: [], historyCursor: 0 }; }
function setup(initial = state(), overrides?: { fail?: boolean; delay?: Promise<void>; unavailable?: Set<string> }) {
  const trusted = registry(); const commits: AtomicCommit[] = []; const authoritativeCraft = new Map(Object.keys(initial.panels).map((id) => [id, initial.panels[id]!.craftId]));
  const resolve = (p: DurablePanel): TrustedPanelResolution | { reason: string } => {
    if (overrides?.unavailable?.has(p.id)) return { reason: 'removed-definition' };
    const craftId = authoritativeCraft.get(p.id); if (!craftId || craftId !== p.craftId) return { reason: 'owner-mismatch' };
    const resolved = resolvePanelTarget(p.target, { craftId }, trusted); return resolved.ok ? { craftId, resolved } : { reason: resolved.reason };
  };
  const atomicCommit = vi.fn(async (commit: AtomicCommit) => { await overrides?.delay; commits.push(commit); if (!overrides?.fail) for (const panel of Object.values(commit.next.panels)) authoritativeCraft.set(panel.id, panel.craftId); return !overrides?.fail; });
  const coordinator = new SurfaceOpeningCoordinator([initial], { resolvePanel: resolve, resolveAction: (invoking, actionId) => {
    if (actionId === 'removed-factory') return { reason: 'factory-unavailable' };
    const surface = ({ 'open-code': 'code', 'open-forms': 'forms' } as Record<string, string>)[actionId]; if (!surface) return { reason: 'unknown-action' };
    const candidate = panel('requested', surface, '', null, invoking.craftId); const resolution = resolvePanelTarget(candidate.target, { craftId: invoking.craftId }, trusted);
    return resolution.ok ? { craftId: invoking.craftId, resolved: resolution, actionIdentity: `${actionId}:${invoking.craftId}` } : { reason: resolution.reason };
  }, serializeValidatedLayout: (next) => structuralSnapshot(next), atomicCommit });
  return { coordinator, atomicCommit, commits, authoritativeCraft, trusted };
}
const open = (actionId = 'open-code', intent: 'beside' | 'maximized' = 'beside') => ({ voyageId: 'voyage', invokingPanelId: 'agent', actionId, intent });

describe('trusted generic surface opening', () => {
  it('creates generic Code and Forms with one atomic aggregate/history/layout commit', async () => {
    for (const actionId of ['open-code', 'open-forms']) { const { coordinator, commits } = setup(); const result = await coordinator.open(open(actionId)); expect(result.created).toBe(true); expect(commits).toHaveLength(1); expect(commits[0]).toMatchObject({ expectedRevision: 0, historyCursor: 1 }); expect(commits[0]!.historyCheckpoint).not.toBeNull(); expect(commits[0]!.layoutSnapshot).toEqual(structuralSnapshot(commits[0]!.next)); }
  });

  it('re-resolves every candidate and ignores tampered, stale, removed, and unrelated authority', async () => {
    const initial = state(); initial.panels.tampered = panel('tampered', 'forms', 'g1', 99); (initial.panels.tampered as DurablePanel & { equivalenceKey: string }).equivalenceKey = 'code:w1'; initial.panels.stale = panel('stale', 'code', 'g2', 98); initial.panels.foreign = panel('foreign', 'code', 'g3', 100, 'unrelated', 'w2'); initial.panels.plugin = { ...panel('plugin', 'code', 'g4', 101), target: { version: 1, kind: 'plugin-surface', pluginId: 'removed.plugin', surfaceKey: 'code' } }; initial.panels.malformed = { ...panel('malformed', 'code', 'g5', 102), target: { version: 99, kind: 'bogus' } as unknown as PanelTarget };
    initial.groups.push({ id: 'g1', panelIds: ['tampered'], activePanelId: 'tampered', rect: { x: 300, y: 0, width: 300, height: 300 } }, { id: 'g2', panelIds: ['stale'], activePanelId: 'stale', rect: { x: 600, y: 0, width: 300, height: 300 } }, { id: 'g3', panelIds: ['foreign'], activePanelId: 'foreign', rect: { x: 600, y: 300, width: 300, height: 300 } }, { id: 'g4', panelIds: ['plugin'], activePanelId: 'plugin', rect: { x: 900, y: 0, width: 300, height: 300 } }, { id: 'g5', panelIds: ['malformed'], activePanelId: 'malformed', rect: { x: 900, y: 300, width: 300, height: 300 } });
    const env = setup(initial, { unavailable: new Set(['stale']) });
    const result = await env.coordinator.open(open()); expect(result.created).toBe(true); expect(result.panelId).not.toMatch(/tampered|stale|foreign/);
    await expect(env.coordinator.open(open('removed-factory'))).rejects.toThrow('factory-unavailable');
    const mismatch = setup(state()); mismatch.authoritativeCraft.set('agent', 'unrelated'); await expect(mismatch.coordinator.open(open())).rejects.toThrow('invoking-target-unavailable');
  });

  it('coalesces identical pending commands exactly once and clears success/failure keys', async () => {
    let release!: () => void; const delay = new Promise<void>((resolve) => { release = resolve; }); const env = setup(state(), { delay });
    const promises = Array.from({ length: 5 }, () => env.coordinator.open(open())); expect(new Set(promises).size).toBe(1); release(); const results = await Promise.all(promises); expect(new Set(results.map(({ revision }) => revision))).toEqual(new Set([1])); expect(env.atomicCommit).toHaveBeenCalledOnce(); expect(env.coordinator.state('voyage').activationSequence).toBe(11);
    await env.coordinator.open(open()); expect(env.atomicCommit).toHaveBeenCalledTimes(2);
    const failed = setup(state(), { fail: true }); const a = failed.coordinator.open(open()); const b = failed.coordinator.open(open()); expect(a).toBe(b); await expect(a).rejects.toThrow('revision-conflict'); await expect(failed.coordinator.open(open())).rejects.toThrow('revision-conflict'); expect(failed.atomicCommit).toHaveBeenCalledTimes(2); expect(failed.coordinator.state('voyage')).toEqual(state());
  });

  it('uses geometry for adjacency in nested layouts, not array neighbors', async () => {
    const initial = state(); initial.groups[0]!.rect = { x: 0, y: 0, width: 400, height: 600 };
    initial.panels.arrayNeighbor = panel('arrayNeighbor', 'code', 'bottom', 99); initial.panels.realNeighbor = panel('realNeighbor', 'code', 'right', 2);
    initial.groups.push({ id: 'bottom', panelIds: ['arrayNeighbor'], activePanelId: 'arrayNeighbor', rect: { x: 500, y: 300, width: 400, height: 300 } }, { id: 'right', panelIds: ['realNeighbor'], activePanelId: 'realNeighbor', rect: { x: 400, y: 0, width: 500, height: 300 } });
    expect(areVisiblyAdjacent(initial.groups[0]!.rect, initial.groups[2]!.rect)).toBe(true);
    const { coordinator } = setup(initial); expect((await coordinator.open(open())).panelId).toBe('realNeighbor');
    const invalid = state(); invalid.groups[0]!.rect.width = Number.NaN; expect(() => validateTopology(invalid)).toThrow('invalid-layout-topology');
  });

  it('uses approved narrow activate-and-maximize fallback in one checkpoint', async () => {
    const initial = state(500); initial.panels.code = panel('code', 'code', 'code-group', 4); initial.groups.push({ id: 'code-group', panelIds: ['code'], activePanelId: 'code', rect: { x: 0, y: 0, width: 500, height: 600 } });
    const { coordinator, commits } = setup(initial); await coordinator.open(open()); expect(coordinator.state('voyage').maximizedGroupId).toBe('code-group'); expect(commits).toHaveLength(1); expect(commits[0]!.historyCheckpoint).not.toBeNull();
  });

  it('preserves activation rules through structural undo/redo and deterministic ties', async () => {
    const initial = state(); initial.panels.b = panel('b', 'code', 'gb', null); initial.panels.a = panel('a', 'code', 'ga', null); initial.groups.push({ id: 'gb', panelIds: ['b'], activePanelId: 'b', rect: { x: 700, y: 300, width: 200, height: 300 } }, { id: 'ga', panelIds: ['a'], activePanelId: 'a', rect: { x: 700, y: 0, width: 200, height: 300 } });
    const { coordinator } = setup(initial); const first = await coordinator.open(open('open-code', 'maximized')); expect(first.panelId).toBe('a'); const sequence = coordinator.state('voyage').activationSequence;
    await coordinator.undo('voyage'); expect(coordinator.state('voyage').activationSequence).toBe(sequence); expect(coordinator.state('voyage').panels.a!.lastActivatedSequence).toBe(sequence);
    await coordinator.redo('voyage'); expect(coordinator.state('voyage').activationSequence).toBe(sequence); await coordinator.restore('voyage'); expect(coordinator.state('voyage').activationSequence).toBe(sequence);
    expect((await coordinator.open(open('open-code', 'maximized'))).panelId).toBe('a'); expect(coordinator.state('voyage').activationSequence).toBe(sequence + 1);
  });

  it('uses stable Panel ID for both equal and missing activation sequences', async () => {
    for (const sequence of [null, 5] as const) {
      const initial = state(); initial.activationSequence = 5; initial.panels.z = panel('z', 'code', 'gz', sequence); initial.panels.a = panel('a', 'code', 'ga', sequence); initial.groups.push({ id: 'gz', panelIds: ['z'], activePanelId: 'z', rect: { x: 700, y: 300, width: 200, height: 300 } }, { id: 'ga', panelIds: ['a'], activePanelId: 'a', rect: { x: 700, y: 0, width: 200, height: 300 } });
      expect((await setup(initial).coordinator.open(open('open-code', 'maximized'))).panelId).toBe('a');
    }
  });

  it('gives structurally recreated Panels null recency until meaningful activation', async () => {
    const env = setup(); const created = await env.coordinator.open(open()); const afterCreate = env.coordinator.state('voyage').activationSequence; await env.coordinator.undo('voyage'); expect(env.coordinator.state('voyage').panels[created.panelId]).toBeUndefined(); await env.coordinator.redo('voyage'); expect(env.coordinator.state('voyage').panels[created.panelId]!.lastActivatedSequence).toBeNull(); expect(env.coordinator.state('voyage').activationSequence).toBe(afterCreate); await env.coordinator.open(open()); expect(env.coordinator.state('voyage').panels[created.panelId]!.lastActivatedSequence).toBe(afterCreate + 1);
  });
});
