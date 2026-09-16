/* eslint-disable formatjs/no-literal-string-in-object -- isolated contract fixture labels */
import { createDockview, type DockviewApi, type SerializedDockview } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { resolvePanelTarget, type CapabilityDescriptor, type PanelTarget, type TrustedTargetRegistry } from './targetRegistry';
import { SurfaceOpeningCoordinator, type OpenIntent, type VoyageState } from './surfaceOpeningCoordinator';

const capabilities: CapabilityDescriptor = { sandbox: ['allow-scripts'], clipboardRead: false, clipboardWrite: false, sameOrigin: false, navigation: 'resolved-origin' };
const target = (surfaceKey: string, workspaceId = 'workspace-1'): PanelTarget => ({ version: 1, kind: 'workspace-surface', workspaceId, surfaceKey });
const definition = (surfaceKey: string) => ({ resolve: (context: { workspaceId?: string }) => ({
  rendererKey: `renderer:${surfaceKey}`, payload: {}, provenance: 'built-in' as const, capabilities,
  runtime: { kind: 'leaseable-runtime' as const }, splitCompatibility: ['workbench'],
  equivalenceInputs: [surfaceKey, context.workspaceId!], sharingInputs: [surfaceKey, context.workspaceId!],
}) });
const registry: TrustedTargetRegistry = {
  crafts: { craft: { workspaceId: 'workspace-1', allowedScopes: ['agent', 'code', 'forms'] } },
  workspaces: { 'workspace-1': { available: true, containerRef: '/workspace' } },
  surfaces: { agent: definition('agent'), code: definition('code'), forms: definition('forms') },
  internalRoutes: {}, installedPlugins: new Set(), factories: {}, customUrl: definition('custom'),
};

const dockviewElement = document.querySelector<HTMLElement>('#surface-dockview')!;
const runtimeLayer = document.querySelector<HTMLElement>('#runtime-layer')!;
const status = document.querySelector<HTMLOutputElement>('#surface-status')!;
const runtimes = new Map<string, { element: HTMLIFrameElement; bootId: string }>();
const RELOAD_KEY = 'dockview-surface-opening-reload';
let api!: DockviewApi;
let coordinator: SurfaceOpeningCoordinator;
let checkpoints: Array<{ before: SerializedDockview; after: SerializedDockview }> = [];
let redoStack: Array<{ before: SerializedDockview; after: SerializedDockview }> = [];
let pendingBefore: SerializedDockview | undefined;
let casWrites = 0;
let coordinatorCommands = 0;

function runtimeFor(panelId: string) {
  let runtime = runtimes.get(panelId);
  if (!runtime) {
    const iframe = document.createElement('iframe');
    iframe.title = `Runtime ${panelId}`;
    iframe.dataset.runtimeId = panelId;
    const bootId = `surface-runtime-${crypto.randomUUID()}`;
    iframe.src = `/spikes/dockview-contract/iframe-fixture.html?boot=${encodeURIComponent(bootId)}`;
    iframe.style.cssText = 'height:100%;width:100%;border:0';
    runtime = { element: iframe, bootId };
    runtimes.set(panelId, runtime);
  }
  return runtime;
}

function createComponent() {
  const element = document.createElement('div');
  element.style.cssText = 'height:100%;width:100%';
  let runtime: ReturnType<typeof runtimeFor> | undefined;
  return {
    element,
    init(parameters: { params: Record<string, unknown> }) {
      runtime = runtimeFor(String(parameters.params.panelId));
      element.append(runtime.element);
    },
    dispose() {
      if (runtime?.element.isConnected) runtimeLayer.append(runtime.element);
    },
  };
}

function createApi(): DockviewApi {
  const next = createDockview(dockviewElement, { createComponent, disableFloatingGroups: true });
  next.layout(Number.parseInt(dockviewElement.style.width, 10), 420);
  next.onDidMaximizedGroupChange(({ isMaximized }) => {
    document.querySelector<HTMLButtonElement>('#restore-layout')!.disabled = !isMaximized;
  });
  return next;
}

function baseVoyage(width = 900): VoyageState {
  return {
    id: 'voyage-current', width, revision: 0, activationSequence: 1, historyCheckpointCount: 0,
    panels: { agent: { id: 'agent', voyageId: 'voyage-current', craftId: 'craft', target: target('agent'), equivalenceKey: 'agent:workspace-1', groupId: 'agent-group', lastActivatedSequence: 1, runtimeId: 'runtime:agent' } },
    groups: [{ id: 'agent-group', panelIds: ['agent'], activePanelId: 'agent', widthRatio: 1 }], maximizedGroupId: null,
  };
}

function newCoordinator(state: VoyageState) {
  return new SurfaceOpeningCoordinator([state], {
    resolve: (value, craftId) => resolvePanelTarget(value, { craftId }, registry),
    compareAndSwap: () => { casWrites += 1; return true; },
    checkpoint: () => undefined,
  });
}

function addPanel(panelId: string, surfaceKey: string, position?: { direction: 'right'; referencePanel: string } | { referencePanel: string }): void {
  if (api.getPanel(panelId)) return;
  api.addPanel({ id: panelId, component: 'surface', title: surfaceKey[0]!.toUpperCase() + surfaceKey.slice(1), params: { panelId }, renderer: 'always', ...(position ? { position } : {}) });
}

function initialize(width = 900): void {
  api?.dispose();
  dockviewElement.replaceChildren();
  dockviewElement.style.width = `${width}px`;
  checkpoints = [];
  redoStack = [];
  casWrites = 0;
  coordinatorCommands = 0;
  api = createApi();
  addPanel('agent', 'agent');
  coordinator = newCoordinator(baseVoyage(width));
  renderStatus();
}

function renderStatus(): void {
  const state = coordinator.state('voyage-current');
  status.textContent = JSON.stringify({ revision: state.revision, history: state.historyCheckpointCount, active: api.activePanel?.id ?? null, maximized: api.activePanel?.api.isMaximized() ?? false, groups: api.groups.length });
  document.querySelector<HTMLButtonElement>('#undo-layout')!.disabled = checkpoints.length === 0;
  document.querySelector<HTMLButtonElement>('#redo-layout')!.disabled = redoStack.length === 0;
}

async function open(surfaceKey: 'code' | 'forms', intent: OpenIntent) {
  pendingBefore = structuredClone(api.toJSON());
  coordinatorCommands += 1;
  const result = await coordinator.open({ voyageId: 'voyage-current', invokingPanelId: 'agent', craftId: 'craft', target: target(surfaceKey), intent });
  const selected = coordinator.state('voyage-current').panels[result.panelId]!;
  if (result.created) addPanel(result.panelId, surfaceKey, intent === 'beside' && dockviewElement.clientWidth >= 640 ? { direction: 'right', referencePanel: 'agent' } : { referencePanel: 'agent' });
  if (result.moved) {
    const anchorId = `placement-anchor:${result.panelId}`;
    api.addPanel({ id: anchorId, component: 'surface', title: 'Placement anchor', params: { panelId: anchorId }, position: { direction: 'right', referencePanel: 'agent' } });
    const destination = api.getPanel(anchorId)!.group;
    api.getPanel(result.panelId)!.api.moveTo({ group: destination });
    api.removePanel(api.getPanel(anchorId)!);
  }
  api.getPanel(result.panelId)!.api.setActive();
  if (intent === 'maximized') api.getPanel(result.panelId)!.api.maximize();
  if (!result.focusedOnly) {
    checkpoints.push({ before: pendingBefore, after: structuredClone(api.toJSON()) });
    redoStack = [];
  }
  pendingBefore = undefined;
  renderStatus();
  return { ...result, runtimeId: selected.runtimeId };
}

function undo(): void {
  const checkpoint = checkpoints.pop();
  if (!checkpoint) return;
  redoStack.push(checkpoint);
  api.fromJSON(checkpoint.before, { reuseExistingPanels: true });
  renderStatus();
}

function redo(): void {
  const checkpoint = redoStack.pop();
  if (!checkpoint) return;
  checkpoints.push(checkpoint);
  api.fromJSON(checkpoint.after, { reuseExistingPanels: true });
  renderStatus();
}

function seedSelectionScenario(): void {
  const state = baseVoyage();
  state.panels['code-adjacent'] = { id: 'code-adjacent', voyageId: state.id, craftId: 'craft', target: target('code'), equivalenceKey: 'code:workspace-1', groupId: 'adjacent', lastActivatedSequence: 2, runtimeId: 'runtime:code-adjacent' };
  state.panels['code-newer'] = { id: 'code-newer', voyageId: state.id, craftId: 'craft', target: target('code'), equivalenceKey: 'code:workspace-1', groupId: 'newer', lastActivatedSequence: 9, runtimeId: 'runtime:code-newer' };
  state.groups.push({ id: 'adjacent', panelIds: ['code-adjacent'], activePanelId: 'code-adjacent', widthRatio: 0.33 }, { id: 'newer', panelIds: ['code-newer'], activePanelId: 'code-newer', widthRatio: 0.33 });
  api.dispose(); dockviewElement.replaceChildren(); api = createApi(); addPanel('agent', 'agent'); addPanel('code-adjacent', 'code', { direction: 'right', referencePanel: 'agent' }); addPanel('code-newer', 'code', { direction: 'right', referencePanel: 'code-adjacent' });
  checkpoints = []; redoStack = []; casWrites = 0; coordinatorCommands = 0; coordinator = newCoordinator(state); renderStatus();
}

document.querySelector('#open-code-beside')!.addEventListener('click', () => void open('code', 'beside'));
document.querySelector('#open-forms-beside')!.addEventListener('click', () => void open('forms', 'beside'));
document.querySelector('#open-code-maximized')!.addEventListener('click', () => void open('code', 'maximized'));
document.querySelector('#restore-layout')!.addEventListener('click', () => { api.exitMaximizedGroup(); renderStatus(); });
document.querySelector('#undo-layout')!.addEventListener('click', undo);
document.querySelector('#redo-layout')!.addEventListener('click', redo);

window.surfaceOpeningContract = {
  initialize,
  open,
  undo,
  redo,
  restore: () => { api.exitMaximizedGroup(); renderStatus(); },
  seedSelectionScenario,
  removeAdjacent: () => {
    addPanel('spacer', 'forms', { direction: 'right', referencePanel: 'agent' });
    const state = coordinator.state('voyage-current');
    state.panels.spacer = { id: 'spacer', voyageId: state.id, craftId: 'craft', target: target('forms'), equivalenceKey: 'forms:workspace-1', groupId: 'spacer', lastActivatedSequence: null, runtimeId: 'runtime:spacer' };
    state.groups.splice(1, 0, { id: 'spacer', panelIds: ['spacer'], activePanelId: 'spacer', widthRatio: 0.2 });
    coordinator = newCoordinator(state);
  },
  evictAndRestore: () => {
    const snapshot = structuredClone(api.toJSON());
    api.dispose(); dockviewElement.replaceChildren(); api = createApi(); api.fromJSON(snapshot); renderStatus();
  },
  persistForReload: () => sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ snapshot: api.toJSON(), state: coordinator.state('voyage-current') })),
  snapshot: () => structuredClone(api.toJSON()),
  observations: () => ({
    ...JSON.parse(status.textContent || '{}') as Record<string, unknown>, casWrites, coordinatorCommands,
    checkpoints: checkpoints.length, runtimeBoots: Object.fromEntries([...runtimes].map(([id, runtime]) => [id, runtime.bootId])),
    groupPanels: api.groups.map((group) => group.panels.map((panel) => panel.id)), browserFullscreen: Boolean(document.fullscreenElement),
    panelRects: Object.fromEntries(api.panels.map((panel) => {
      const rect = panel.group.element.getBoundingClientRect();
      return [panel.id, { left: rect.left, right: rect.right, width: rect.width, groupId: panel.group.id }];
    })),
  }),
};

const reloadState = sessionStorage.getItem(RELOAD_KEY);
sessionStorage.removeItem(RELOAD_KEY);
initialize();
if (reloadState) {
  const persisted = JSON.parse(reloadState) as { snapshot: SerializedDockview; state: VoyageState };
  coordinator = newCoordinator(persisted.state);
  api.fromJSON(persisted.snapshot);
  renderStatus();
}
status.dataset.ready = 'true';

declare global {
  interface Window {
    surfaceOpeningContract: {
      initialize(width?: number): void;
      open(surfaceKey: 'code' | 'forms', intent: OpenIntent): Promise<unknown>;
      undo(): void;
      redo(): void;
      restore(): void;
      seedSelectionScenario(): void;
      removeAdjacent(): void;
      evictAndRestore(): void;
      persistForReload(): void;
      snapshot(): SerializedDockview;
      observations(): Record<string, unknown>;
    };
  }
}
