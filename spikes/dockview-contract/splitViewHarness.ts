/* eslint-disable formatjs/no-literal-string-in-object -- isolated contract fixture labels */
import { createDockview, type DockviewApi } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { createSplitApplication, type DurablePortName, type SplitOperation } from './splitApplication';
import { resolveSplitIntent, type AcquirableTarget, type SplitFixtures } from './splitViewContract';
import type { TrustedDefinition, TrustedTargetRegistry } from './targetRegistry';

type RootMap = Map<string, HTMLElement>;
type PayloadRuntime = { id: string; payload: HTMLElement; window?: Window | null; originalComponent: 'agent' | 'code'; generation: number; valid: boolean; splitOnly: boolean; disposed: boolean };
const durableElement = document.querySelector<HTMLElement>('#durable')!;
const transientElement = document.querySelector<HTMLElement>('#transient')!;
const runtimeLayer = document.querySelector<HTMLElement>('#runtime-layer')!;
durableElement.style.cssText = 'height:420px;width:900px;position:relative'; transientElement.style.cssText = 'height:420px;width:900px;position:relative'; runtimeLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20';
function components(roots: RootMap) { return ({ name }: { name: string }) => { const element = document.createElement('div'); element.tabIndex = -1; element.dataset.rendererRoot = name; element.style.cssText = 'height:100%;min-width:240px;background:#eef'; roots.set(name, element); return { element, minimumWidth: 240, init() {}, dispose() { roots.delete(name); } }; }; }
function restrictedTab() { const element = document.createElement('span'); return { element, init(parameters: { title: string }) { element.textContent = parameters.title; } }; }
const durableRoots: RootMap = new Map(); const transientRoots: RootMap = new Map();
const durable = createDockview(durableElement, { createComponent: components(durableRoots), disableFloatingGroups: true }); durable.layout(900, 420); durable.addPanel({ id: 'agent', component: 'agent', title: 'Agent' }); durable.addPanel({ id: 'code', component: 'code', title: 'Code', position: { direction: 'right', referencePanel: 'agent' } }); durable.getPanel('agent')!.api.setActive();
let durableMutations = 0; durable.onWillMutateLayout(() => durableMutations += 1);
const durableStructure = () => JSON.stringify(durable.groups.map((group) => ({ id: group.id, panels: group.panels.map((panel) => panel.id), active: group.activePanel?.id }))); const initialDurableStructure = durableStructure();

function iframe(id: string) { const element = document.createElement('iframe'); element.src = `/spikes/dockview-contract/iframe-fixture.html?split-runtime=${id}`; element.dataset.runtimePayload = id; element.style.cssText = 'position:fixed;border:0;pointer-events:auto'; runtimeLayer.append(element); return element; }
const agentFrame = iframe('agent'); const codeFrame = iframe('code'); const pluginFrame = iframe('plugin-review');
const runtimes = new Map<string, PayloadRuntime>([
  ['agent', { id: 'agent', payload: agentFrame, window: agentFrame.contentWindow, originalComponent: 'agent', generation: 1, valid: true, splitOnly: false, disposed: false }],
  ['code', { id: 'code', payload: codeFrame, window: codeFrame.contentWindow, originalComponent: 'code', generation: 4, valid: true, splitOnly: false, disposed: false }],
  ['plugin-review', { id: 'plugin-review', payload: pluginFrame, window: pluginFrame.contentWindow, originalComponent: 'code', generation: 2, valid: true, splitOnly: false, disposed: false }],
]);
const attachments = new Map<string, HTMLElement>([['agent', durableRoots.get('agent')!], ['code', durableRoots.get('code')!], ['plugin-review', durableRoots.get('code')!]]); const hostEvents = ['attach:durable:agent@1', 'attach:durable:code@4', 'attach:durable:plugin-review@2'];
let transient: DockviewApi | undefined; let transientMutations = 0; let mode: 'wide' | 'narrow' = 'wide'; let ratio = 0.5; let invocation = 0; let phase: 'inactive' | 'entering' | 'active' | 'exiting' = 'inactive'; let pinned = false; let transitionToken = 0; let historyEntries = 0; let focusFallbacks = 0; let invokingRuntimeId = 'agent'; let selectedRuntimeId = 'code'; let disposedPayloads = 0; let focusAfterAttachments = false;
type PendingTransition = { token: number; resolution: ReturnType<typeof trustedResolution>; acquired: string[]; targets: [AcquirableTarget, AcquirableTarget]; runtimeIds: [string?, string?]; pluginIds: string[]; voyageToken: string };
let pendingTransition: PendingTransition | undefined;
const budget = {
  limit: 2,
  pinned: new Set<string>(),
  active: new Set<string>(),
  pending: new Set<string>(),
  registrations: new Map<string, number>([['agent', 1], ['code', 1], ['plugin-review', 1], ['competing-controller', 2]]),
  evictions: [] as string[],
  decisions: [] as string[],
  register(id: string, cost = 1) { this.registrations.set(id, cost); },
  unregister(id: string) { this.registrations.delete(id); this.active.delete(id); this.pending.delete(id); },
  cost(ids: Set<string>) { return [...ids].reduce((total, id) => total + (this.registrations.get(id) ?? 0), 0); },
  acquirePending(id: string) {
    const runtimeCost = this.registrations.get(id);
    const pressure = this.cost(this.active) + this.cost(this.pending) + (runtimeCost ?? 0);
    if (runtimeCost === undefined) { this.decisions.push(`reject:${id}:unregistered`); return false; }
    if (pressure > this.limit) { this.decisions.push(`reject:${id}:${pressure}/${this.limit}`); return false; }
    this.pending.add(id); this.decisions.push(`pending:${id}:${pressure}/${this.limit}`); return true;
  },
  activate(ids: string[]) { for (const id of ids) { this.pending.delete(id); this.active.add(id); } },
  release(ids: string[]) { for (const id of ids) { this.active.delete(id); this.pending.delete(id); } },
  attempt() {
    const candidate = 'competing-controller'; const candidateCost = this.registrations.get(candidate);
    if (candidateCost === undefined) { this.decisions.push(`reject:${candidate}:unregistered`); return false; }
    if (this.active.has(candidate)) { this.decisions.push(`already-active:${candidate}`); return true; }
    const pressure = this.cost(this.active) + this.cost(this.pending) + candidateCost;
    if (pressure > this.limit && this.pinned.has('durable-voyage')) { this.decisions.push(`reject:${candidate}:${pressure}/${this.limit}:pinned`); return false; }
    if (pressure > this.limit) { this.evictions.push(candidate); this.decisions.push(`evict:${candidate}:${pressure}/${this.limit}`); this.unregister(candidate); return true; }
    this.active.add(candidate); this.decisions.push(`admit:${candidate}:${pressure}/${this.limit}`); return true;
  },
};
const forbiddenCounts = { coordinator: 0, serializer: 0, fromJSON: 0, repository: 0, revision: 0, history: 0, autosave: 0 };
const durablePorts = Object.fromEntries(Object.keys(forbiddenCounts).map((name) => [name, () => { forbiddenCounts[name as DurablePortName] += 1; throw new Error(`forbidden:${name}`); }])) as unknown as Parameters<typeof createSplitApplication>[0]['durable'];

function placePayloads() { for (const runtime of runtimes.values()) { const root = attachments.get(runtime.id); if (!root || runtime.disposed) { runtime.payload.hidden = true; continue; } const rect = root.getBoundingClientRect(); runtime.payload.hidden = false; runtime.payload.style.left = `${rect.left}px`; runtime.payload.style.top = `${rect.top}px`; runtime.payload.style.width = `${rect.width}px`; runtime.payload.style.height = `${rect.height}px`; } requestAnimationFrame(placePayloads); } requestAnimationFrame(placePayloads);
function addTopology(nextMode: 'wide' | 'narrow', attachIds = [invokingRuntimeId, selectedRuntimeId]) { transient!.clear(); mode = nextMode; transient!.addPanel({ id: 'left', component: 'left', tabComponent: 'restricted', title: 'Invoking' }); transient!.addPanel({ id: 'right', component: 'right', tabComponent: 'restricted', title: 'Selected', position: nextMode === 'wide' ? { direction: 'right', referencePanel: 'left' } : { referencePanel: 'left' } }); if (nextMode === 'narrow') transient!.getPanel('left')!.api.setActive(); transient!.layout(nextMode === 'wide' ? 900 : 480, 420); if (nextMode === 'wide') transient!.getPanel('left')!.group.api.setSize({ width: 900 * ratio }); if (attachIds.includes(invokingRuntimeId)) attachments.set(invokingRuntimeId, transientRoots.get('left')!); if (attachIds.includes(selectedRuntimeId)) attachments.set(selectedRuntimeId, transientRoots.get('right')!); }
function makeSplitOnly(role: 'invoking' | 'selected') { const id = `forms-${role}`; const payload = document.createElement('div'); payload.dataset.runtimePayload = id; payload.textContent = 'Forms runtime'; payload.style.cssText = 'position:fixed;background:#efe;pointer-events:none'; runtimeLayer.append(payload); runtimes.set(id, { id, payload, originalComponent: 'code', generation: 1, valid: true, splitOnly: true, disposed: false }); budget.register(id); return id; }
function disposeRuntime(runtime: PayloadRuntime) { if (runtime.disposed) return; runtime.disposed = true; attachments.delete(runtime.id); runtime.payload.remove(); budget.unregister(runtime.id); disposedPayloads += 1; hostEvents.push(`dispose:${runtime.id}`); }

function runtimeIdFor(target: AcquirableTarget, role: 'invoking' | 'selected') { if (target.runtime.kind === 'recreatable') return makeSplitOnly(role); if (target.resolved.equivalenceKey.startsWith('code:')) return 'code'; if (target.resolved.equivalenceKey.startsWith('plugin-review:')) return 'plugin-review'; return 'agent'; }
function tryAcquirePendingRuntime(target: AcquirableTarget, role: 'invoking' | 'selected') {
  const id = runtimeIdFor(target, role); const runtime = runtimes.get(id);
  if (!runtime?.valid || !budget.acquirePending(id)) { if (runtime?.splitOnly) disposeRuntime(runtime); return undefined; }
  return id;
}
function unpin() { pinned = false; budget.pinned.delete('durable-voyage'); hostEvents.push('unpin'); }
function beginDeferred(search = '?voyage=voyage-a&split=panel-agent&withSurface=code') {
  if (phase !== 'inactive') return false;
  phase = 'entering'; transitionToken += 1; pinned = true; budget.pinned.add('durable-voyage'); hostEvents.push(`pin:${transitionToken}`);
  const resolution = trustedResolution(search);
  if (!resolution?.ok) { unpin(); phase = 'inactive'; return false; }
  pendingTransition = { token: transitionToken, resolution, acquired: [], targets: [resolution.invoking, resolution.selected], runtimeIds: [], pluginIds: [resolution.invoking.pluginId, resolution.selected.pluginId].filter((value): value is string => Boolean(value)), voyageToken: resolution.intent.voyageToken };
  hostEvents.push(`pending:${transitionToken}`);
  return true;
}
function prepareTransient() {
  invocation += 1; ratio = 0.5; transientMutations = 0; focusAfterAttachments = false;
  durableElement.style.visibility = 'hidden'; transientElement.hidden = false;
  transient = createDockview(transientElement, { createComponent: components(transientRoots), createTabComponent: restrictedTab, disableDnd: true, disableFloatingGroups: true });
  transient.onWillMutateLayout(() => transientMutations += 1); addTopology('wide', []);
}
function acquireFirstDeferred() {
  const pending = pendingTransition;
  if (!pending || phase !== 'entering' || pending.token !== transitionToken || pending.acquired.length !== 0) return false;
  const id = tryAcquirePendingRuntime(pending.targets[0], 'invoking');
  if (!id) { exit(); return false; }
  pending.runtimeIds[0] = id; invokingRuntimeId = id;
  selectedRuntimeId = pending.targets[1].runtime.kind === 'recreatable' ? 'pending-selected' : runtimeIdFor(pending.targets[1], 'selected');
  const runtime = runtimes.get(id);
  if (!runtime?.valid) { exit(); return false; }
  prepareTransient(); pending.acquired.push(id); attachments.set(id, transientRoots.get('left')!);
  hostEvents.push(`detach:durable:${id}`, `attach:pending:${id}`);
  return true;
}
function completeDeferred() {
  const pending = pendingTransition;
  if (!pending || phase !== 'entering' || pending.token !== transitionToken || !pending.resolution.ok) return false;
  if (pending.acquired.length === 0 && !acquireFirstDeferred()) return false;
  const secondId = tryAcquirePendingRuntime(pending.targets[1], 'selected');
  if (!secondId) { exit(); return false; }
  pending.runtimeIds[1] = secondId; selectedRuntimeId = secondId;
  pending.acquired.push(secondId); attachments.set(secondId, transientRoots.get('right')!);
  if (pending.acquired.some((id) => !runtimes.get(id)?.valid)) { exit(); return false; }
  budget.activate(pending.acquired);
  hostEvents.push(`detach:durable:${secondId}`, `attach:transient:${secondId}@${transitionToken}`);
  transientRoots.get('left')!.focus(); focusAfterAttachments = document.activeElement === transientRoots.get('left'); hostEvents.push('focus:split'); phase = 'active'; pendingTransition = undefined; return true;
}
function enter(push = true, resolve = () => trustedResolution('?voyage=voyage-a&split=panel-agent&withSurface=code')) { if (phase !== 'inactive') return; const search = location.search || '?voyage=voyage-a&split=panel-agent&withSurface=code'; beginDeferred(search); if (!pendingTransition) return; if (resolve !== trustedResolution) { const pending = pendingTransition; const resolution = resolve(); if (pending && resolution?.ok) pending.resolution = resolution; } completeDeferred(); if ((phase as string) === 'active' && push) { history.pushState({ split: true }, '', location.search || search); historyEntries += 1; } }
function releaseRuntime(id: string, pending = false) { const runtime = runtimes.get(id); if (!runtime) return; hostEvents.push(`detach:${pending ? 'pending' : 'transient'}:${id}`); if (runtime.splitOnly || !runtime.valid) disposeRuntime(runtime); else { const root = durableRoots.get(runtime.originalComponent); if (root?.isConnected) { attachments.set(id, root); hostEvents.push(`return:durable:${id}@${runtime.generation}`); } else disposeRuntime(runtime); } }
function disposeTransientController() { transient?.dispose(); transient = undefined; transientRoots.clear(); transientElement.hidden = true; durableElement.style.visibility = 'visible'; }
function exit() { if (phase === 'inactive' || phase === 'exiting') return; const pending = pendingTransition; if (phase === 'entering') { const acquired = [...(pending?.acquired ?? [])].reverse(); budget.release(acquired); for (const id of acquired) releaseRuntime(id, true); pendingTransition = undefined; disposeTransientController(); unpin(); phase = 'inactive'; return; } phase = 'exiting'; budget.release([invokingRuntimeId, selectedRuntimeId]); for (const id of [selectedRuntimeId, invokingRuntimeId]) releaseRuntime(id); disposeTransientController(); unpin(); phase = 'inactive'; const invoking = runtimes.get(invokingRuntimeId); const root = invoking && !invoking.splitOnly ? durableRoots.get(invoking.originalComponent) : undefined; if (root?.isConnected && invoking?.valid) root.focus(); else { document.querySelector<HTMLElement>('#back')!.focus(); focusFallbacks += 1; } }
function invalidate(kind: 'selected-replace' | 'selected-delete' | 'voyage' | 'plugin') { if (kind === 'voyage') for (const runtime of runtimes.values()) runtime.valid = false; else if (kind === 'plugin') { trustedFixtures.targetRegistry.installedPlugins.delete('plugin.review'); const pluginRuntime = runtimes.get('plugin-review'); if (pluginRuntime) pluginRuntime.valid = false; } else { const runtime = runtimes.get(selectedRuntimeId); if (runtime) { runtime.valid = false; if (kind === 'selected-replace') runtime.generation += 1; } } exit(); }
function narrow() { if (transient && mode === 'wide') { const maximized = Boolean(transient.getPanel('left')?.api.isMaximized() || transient.getPanel('right')?.api.isMaximized()); const groups = transient.groups; if (!maximized) ratio = groups[0]!.api.width / groups.reduce((sum, group) => sum + group.api.width, 0); addTopology('narrow'); } }
function wide() { if (transient && mode === 'narrow') addTopology('wide'); }
function maximize(side: 'left' | 'right') { transient?.getPanel(side)?.api.maximize(); }
function restore() { transient?.exitMaximizedGroup(); }
let requestedInvalidation: 'selected-replace' | 'selected-delete' | 'voyage' | 'plugin' = 'plugin';
const splitPorts: Record<SplitOperation, () => unknown> = { enter, resize: () => undefined, 'maximize-left': () => maximize('left'), 'maximize-right': () => maximize('right'), restore, narrow, wide, invalidate: () => invalidate(requestedInvalidation), exit };
const application = createSplitApplication({ durable: durablePorts, split: splitPorts });

function targetRegistry(): TrustedTargetRegistry { const definition = (key: string, recreatable = false): TrustedDefinition => ({ resolve: (context) => ({ rendererKey: `fixture:${key}`, payload: {}, provenance: 'built-in', capabilities: { sandbox: [], clipboardRead: false, clipboardWrite: false, sameOrigin: false, navigation: 'none' }, runtime: recreatable ? { kind: 'recreatable-transient-runtime', continuity: 'fresh' } : { kind: 'leaseable-runtime' }, splitCompatibility: ['workbench'], equivalenceInputs: [key, context.workspaceId!], sharingInputs: [key, context.workspaceId!] }) }); const pluginDefinition: TrustedDefinition = { pluginId: 'plugin.review', resolve: (context) => ({ rendererKey: 'plugin:review', payload: {}, provenance: 'installed-plugin:plugin.review', capabilities: { sandbox: ['allow-scripts'], clipboardRead: false, clipboardWrite: false, sameOrigin: false, navigation: 'none' }, runtime: { kind: 'leaseable-runtime' }, splitCompatibility: ['workbench'], equivalenceInputs: ['plugin-review', context.workspaceId!], sharingInputs: ['plugin-review', context.workspaceId!] }) }; return { crafts: { 'craft-a': { workspaceId: 'workspace-a', allowedScopes: ['builtin/agent', 'builtin/code', 'builtin/forms', 'plugin.review/review'] }, 'craft-b': { workspaceId: 'workspace-b', allowedScopes: ['builtin/code', 'builtin/forms'] } }, workspaces: { 'workspace-a': { available: true, containerRef: '/a' }, 'workspace-b': { available: true, containerRef: '/b' } }, surfaces: { 'builtin/agent': definition('agent'), 'builtin/code': definition('code'), 'builtin/forms': definition('forms', true), 'plugin.review/review': pluginDefinition }, internalRoutes: {}, installedPlugins: new Set(['plugin.review']), factories: {}, customUrl: definition('url') }; }
const trustedFixtures: SplitFixtures = { currentVoyageToken: 'voyage-a', panels: [{ token: 'panel-agent', voyageToken: 'voyage-a', craftId: 'craft-a', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-a', surfaceKey: 'builtin/agent' } }, { token: 'panel-forms', voyageToken: 'voyage-a', craftId: 'craft-a', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-a', surfaceKey: 'builtin/forms' } }], voyageCraftIds: ['craft-a', 'craft-b'], candidates: [{ craftId: 'craft-a', surfaceKey: 'code', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-a', surfaceKey: 'builtin/code' } }, { craftId: 'craft-a', surfaceKey: 'forms', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-a', surfaceKey: 'builtin/forms' } }, { craftId: 'craft-a', surfaceKey: 'review', target: { version: 1, kind: 'plugin-surface', pluginId: 'plugin.review', surfaceKey: 'review' } }, { craftId: 'craft-b', surfaceKey: 'code', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-b', surfaceKey: 'builtin/code' } }, { craftId: 'craft-b', surfaceKey: 'forms', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-b', surfaceKey: 'builtin/forms' } }], targetRegistry: targetRegistry(), runtimes: [{ targetIdentity: 'craft-a\0agent:workspace-a', runtimeId: 'agent', generation: 1, hostId: 'durable:agent' }, { targetIdentity: 'craft-a\0code:workspace-a', runtimeId: 'code', generation: 4, hostId: 'durable:code' }, { targetIdentity: 'craft-a\0plugin-review:workspace-a', runtimeId: 'plugin-review', generation: 2, hostId: 'durable:plugin-review', pluginId: 'plugin.review' }, { targetIdentity: 'craft-b\0code:workspace-b', runtimeId: 'code', generation: 4, hostId: 'durable:code' }] };
function trustedResolution(search = location.search) { return resolveSplitIntent(search, trustedFixtures); }
document.querySelector('#back')!.addEventListener('click', () => { if (history.state?.split) history.back(); else { history.replaceState(null, '', location.pathname); application.dispatch('exit'); } }); addEventListener('popstate', () => application.dispatch('exit'));

window.splitContract = {
  enter: () => application.dispatch('enter'), beginDeferred, acquireFirstDeferred, completeDeferred, exit: () => application.dispatch('exit'), narrow: () => application.dispatch('narrow'), wide: () => application.dispatch('wide'), maximize: (side: 'left' | 'right') => application.dispatch(side === 'left' ? 'maximize-left' : 'maximize-right'), restore: () => application.dispatch('restore'),
  maximizeDurable: () => durable.getPanel('agent')!.api.maximize(), restoreDurable: () => durable.exitMaximizedGroup(), bounds: () => ({ left: transientRoots.get('left')?.getBoundingClientRect().toJSON(), right: transientRoots.get('right')?.getBoundingClientRect().toJSON() }),
  observe: () => ({ closed: phase === 'inactive', phase, mode, ratio, invocation, pinned, historyEntries, transientMutations, transientMaximized: Boolean(transient?.getPanel('left')?.api.isMaximized() || transient?.getPanel('right')?.api.isMaximized()), groups: transient?.groups.length ?? 0, active: transient?.activePanel?.id, durableSnapshotUnchanged: durableStructure() === initialDurableStructure, durableMutations, forbidden: { ...forbiddenCounts }, payloads: document.querySelectorAll('[data-runtime-payload]').length, iframeConnected: agentFrame.isConnected, iframeWindowStable: agentFrame.contentWindow === runtimes.get('agent')?.window, selectedWindowStable: codeFrame.contentWindow === runtimes.get('code')?.window, focusFallbacks, focusRestored: document.activeElement === durableRoots.get('agent') || document.activeElement === durableRoots.get('code'), focusAfterAttachments, durableMaximized: durable.getPanel('agent')!.api.isMaximized(), hostEvents: [...hostEvents], disposedPayloads, budgetCount: budget.cost(budget.active) + budget.cost(budget.pending), budgetLimit: budget.limit, budgetRegistrations: budget.registrations.size, budgetEvictions: [...budget.evictions], budgetDecisions: [...budget.decisions], pendingRuntimeCount: budget.pending.size }),
  attemptEviction: () => budget.attempt(), removeBudgetRegistration: (id: string) => budget.unregister(id), invalidate: (kind: 'selected-replace' | 'selected-delete' | 'voyage' | 'plugin') => { requestedInvalidation = kind; return application.dispatch('invalidate'); }, relayoutDurable: () => durable.layout(760, 420), frameState: () => (agentFrame.contentWindow as Window & { fixture?: { read(): unknown } }).fixture?.read(), selectedFrameState: () => (codeFrame.contentWindow as Window & { fixture?: { read(): unknown } }).fixture?.read(),
};
document.querySelector('#ready')!.textContent = 'ready';
if (location.search.includes('voyage=')) enter(false, () => trustedResolution());
declare global { interface Window { splitContract: Record<string, (...args: never[]) => unknown> } }
