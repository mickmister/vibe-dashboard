/* eslint-disable formatjs/no-literal-string-in-object -- isolated contract fixture labels */
import { createDockview, type DockviewApi } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { parseSplitIntent } from './splitViewContract';

type RootMap = Map<string, HTMLElement>;
const durableElement = document.querySelector<HTMLElement>('#durable')!;
const transientElement = document.querySelector<HTMLElement>('#transient')!;
const runtimeLayer = document.querySelector<HTMLElement>('#runtime-layer')!;
durableElement.style.cssText = 'height:420px;width:900px;position:relative';
transientElement.style.cssText = 'height:420px;width:900px;position:relative';
runtimeLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20';

function components(roots: RootMap) {
  return ({ name }: { name: string }) => {
    const element = document.createElement('div'); element.tabIndex = -1; element.dataset.rendererRoot = name; element.style.cssText = 'height:100%;min-width:240px;background:#eef'; roots.set(name, element);
    return { element, minimumWidth: 240, init() {}, dispose() { roots.delete(name); } };
  };
}
function restrictedTab() {
  const element = document.createElement('span');
  return { element, init(parameters: { title: string }) { element.textContent = parameters.title; } };
}
const durableRoots: RootMap = new Map(); const transientRoots: RootMap = new Map();
const durable = createDockview(durableElement, { createComponent: components(durableRoots), disableFloatingGroups: true }); durable.layout(900, 420);
durable.addPanel({ id: 'agent', component: 'agent', title: 'Agent' }); durable.addPanel({ id: 'code', component: 'code', title: 'Code', position: { direction: 'right', referencePanel: 'agent' } });
durable.getPanel('agent')!.api.setActive();
let durableMutations = 0; durable.onWillMutateLayout(() => durableMutations += 1);
const durableStructure = () => JSON.stringify(durable.groups.map((group) => ({ id: group.id, panels: group.panels.map((panel) => panel.id), active: group.activePanel?.id })));
const initialDurableStructure = durableStructure();
let transient: DockviewApi | undefined; let transientMutations = 0; let mode: 'wide' | 'narrow' = 'wide'; let ratio = 0.5; let invocation = 0; let closed = true; let pinned = false; let historyEntries = 0; let focusFallbacks = 0;

const frame = document.createElement('iframe'); frame.src = '/spikes/dockview-contract/iframe-fixture.html?split-runtime=1'; frame.dataset.runtimePayload = 'agent'; frame.style.cssText = 'position:fixed;border:0;pointer-events:auto'; runtimeLayer.append(frame);
const initialFrameWindow = frame.contentWindow;
const appPayload = document.createElement('div'); appPayload.dataset.runtimePayload = 'application'; appPayload.textContent = 'Application runtime'; appPayload.style.cssText = 'position:fixed;background:#efe;pointer-events:none'; runtimeLayer.append(appPayload);
let attachedRoot: HTMLElement | undefined;
function placePayloads() {
  const first = attachedRoot; const second = transientRoots.get('right');
  for (const [payload, root] of [[frame, first], [appPayload, second]] as const) {
    if (!root || closed) { payload.hidden = true; continue; }
    const rect = root.getBoundingClientRect(); payload.hidden = false; payload.style.left = `${rect.left}px`; payload.style.top = `${rect.top}px`; payload.style.width = `${rect.width}px`; payload.style.height = `${rect.height}px`;
  }
  requestAnimationFrame(placePayloads);
}
requestAnimationFrame(placePayloads);

function addTopology(nextMode: 'wide' | 'narrow') {
  transient!.clear(); mode = nextMode;
  transient!.addPanel({ id: 'left', component: 'left', tabComponent: 'restricted', title: 'Invoking' });
  transient!.addPanel({ id: 'right', component: 'right', tabComponent: 'restricted', title: 'Selected', position: nextMode === 'wide' ? { direction: 'right', referencePanel: 'left' } : { referencePanel: 'left' } });
  if (nextMode === 'narrow') transient!.getPanel('left')!.api.setActive();
  transient!.layout(nextMode === 'wide' ? 900 : 480, 420); attachedRoot = transientRoots.get('left');
  if (nextMode === 'wide') transient!.getPanel('left')!.group.api.setSize({ width: 900 * ratio });
}
function enter(push = true) {
  if (!closed) return; closed = false; pinned = true; invocation += 1; ratio = 0.5; transientMutations = 0;
  durableElement.style.visibility = 'hidden'; transientElement.hidden = false;
  transient = createDockview(transientElement, { createComponent: components(transientRoots), createTabComponent: restrictedTab, disableDnd: true, disableFloatingGroups: true }); transient.onWillMutateLayout(() => transientMutations += 1); addTopology('wide');
  if (push) { history.pushState({ split: true }, '', '?split=1&withCraft=craft-a&withSurface=code'); historyEntries += 1; }
}
function exit() { if (closed) return; closed = true; attachedRoot = undefined; transient?.dispose(); transient = undefined; transientRoots.clear(); pinned = false; transientElement.hidden = true; durableElement.style.visibility = 'visible'; const root = durableRoots.get('agent'); if (root?.isConnected) root.focus(); else { (document.querySelector('#back') as HTMLElement).focus(); focusFallbacks += 1; } }
document.querySelector('#back')!.addEventListener('click', () => { if (history.state?.split) history.back(); else { history.replaceState(null, '', location.pathname); exit(); } }); addEventListener('popstate', exit);

window.splitContract = {
  enter,
  exit,
  narrow: () => { if (transient && mode === 'wide') { const groups = transient.groups; ratio = groups[0]!.api.width / groups.reduce((sum, group) => sum + group.api.width, 0); addTopology('narrow'); } },
  wide: () => { if (transient && mode === 'narrow') addTopology('wide'); },
  maximize: (side: 'left' | 'right') => transient?.getPanel(side)?.api.maximize(),
  restore: () => transient?.exitMaximizedGroup(),
  maximizeDurable: () => durable.getPanel('agent')!.api.maximize(),
  restoreDurable: () => durable.exitMaximizedGroup(),
  bounds: () => ({ left: transientRoots.get('left')?.getBoundingClientRect().toJSON(), right: transientRoots.get('right')?.getBoundingClientRect().toJSON() }),
  observe: () => ({ closed, mode, ratio, invocation, pinned, historyEntries, transientMutations, transientMaximized: Boolean(transient?.getPanel('left')?.api.isMaximized() || transient?.getPanel('right')?.api.isMaximized()), groups: transient?.groups.length ?? 0, active: transient?.activePanel?.id, durableSnapshotUnchanged: durableStructure() === initialDurableStructure, durableMutations, toJSONCalls: 0, fromJSONCalls: 0, revisions: 0, writes: 0, history: 0, payloads: document.querySelectorAll('[data-runtime-payload]').length, iframeConnected: frame.isConnected, iframeWindowStable: frame.contentWindow === initialFrameWindow, focusFallbacks, focusRestored: document.activeElement === durableRoots.get('agent'), durableMaximized: durable.getPanel('agent')!.api.isMaximized() }),
  frameState: () => (frame.contentWindow as Window & { fixture?: { read(): unknown } }).fixture?.read(),
};
document.querySelector('#ready')!.textContent = 'ready';
if (parseSplitIntent(location.search)) enter(false);

declare global { interface Window { splitContract: Record<string, (...args: never[]) => unknown> } }
