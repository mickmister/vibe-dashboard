/* eslint-disable formatjs/no-literal-string-in-object -- isolated test fixture labels */
import { createDockview, type DockviewApi, type SerializedDockview } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import {
  DOCKVIEW_LAYOUT_FORMAT_VERSION as VERSION,
  PINNED_DOCKVIEW_VERSION as DOCKVIEW_VERSION,
  type DockviewSnapshotEnvelope as Envelope,
  type SnapshotRejection as Rejection,
  parseDockviewEnvelope,
} from './snapshotPolicy';

type Mutation = { phase: 'will' | 'did'; kind: string; origin: string };

type IframeObservation = {
  bootCount: number;
  bootId: string;
  documentVisibility: DocumentVisibilityState;
  editor: string;
  heartbeats: number;
  input: string;
  listenerEvents: number;
  ready: boolean;
  scrollTop: number;
  visible: boolean;
  voyageVisible: boolean;
};

const dockviewElement = document.querySelector<HTMLElement>('#dockview')!;
dockviewElement.style.cssText = 'height: 500px; width: 900px';

let iframeInstance = 0;

function createComponent({ name }: { name: string }) {
  const element = document.createElement('div');
  return {
    element,
    init(parameters: { params: Record<string, unknown> }) {
      if (name === 'iframe-panel') {
        const iframe = document.createElement('iframe');
        iframe.dataset.contractIframe = String(parameters.params.panelId);
        iframe.src = `/spikes/dockview-contract/iframe-fixture.html?boot=${++iframeInstance}`;
        iframe.style.cssText = 'border: 0; height: 100%; width: 100%';
        element.style.cssText = 'height: 100%; width: 100%';
        element.append(iframe);
      } else {
        element.textContent = String(parameters.params.label ?? 'Panel');
      }
    },
  };
}

const api = createDockview(dockviewElement, {
  createComponent,
  disableFloatingGroups: true,
});
api.layout(900, 500);

const mutationLog: Mutation[] = [];
let fromJSONCalls = 0;
const quarantine: Array<{ reason: Rejection; value: unknown }> = [];
api.onWillMutateLayout(({ kind, origin }) => mutationLog.push({ phase: 'will', kind, origin }));
api.onDidMutateLayout(({ kind, origin }) => mutationLog.push({ phase: 'did', kind, origin }));

const secondaryElement = document.querySelector<HTMLElement>('#secondary-dockview')!;
secondaryElement.style.cssText = 'height: 500px; width: 900px';
const secondaryApi = createDockview(secondaryElement, {
  createComponent,
  disableFloatingGroups: true,
});
secondaryApi.layout(900, 500);
secondaryApi.addPanel({ id: 'secondary-home', component: 'contract-panel', title: 'Secondary' });

const floatingControlElement = document.querySelector<HTMLElement>('#floating-control')!;
floatingControlElement.style.cssText = 'height: 500px; width: 900px';
const floatingControlApi = createDockview(floatingControlElement, { createComponent });
floatingControlApi.layout(900, 500);

function addFirst(): void {
  if (api.getPanel('first')) return;
  const title = 'First';
  api.addPanel({ id: 'first', component: 'contract-panel', title, params: { label: title } });
}

function addBeside(): void {
  addFirst();
  if (api.getPanel('second')) return;
  const title = 'Second';
  api.addPanel({
    id: 'second',
    component: 'contract-panel',
    title,
    params: { label: title },
    position: { direction: 'right', referencePanel: 'first' },
  });
}

function addTab(): void {
  addFirst();
  if (api.getPanel('second')) return;
  const title = 'Second';
  api.addPanel({
    id: 'second',
    component: 'contract-panel',
    title,
    params: { label: title },
    position: { referencePanel: 'first' },
  });
}

function button(label: string, action: () => void): void {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  document.querySelector('#controls')!.append(element);
}

button('Add first panel', addFirst);
button('Add beside', addBeside);
button('Add tab', addTab);
button('Move first right', () => {
  addBeside();
  api.getPanel('first')!.api.moveTo({ group: api.getPanel('second')!.group, position: 'right' });
});
button('Maximize first panel', () => {
  addFirst();
  api.getPanel('first')!.api.maximize();
});
const restoreButton = document.createElement('button');
restoreButton.type = 'button';
restoreButton.textContent = 'Restore layout';
restoreButton.disabled = true;
restoreButton.addEventListener('click', () => api.exitMaximizedGroup());
document.querySelector('#controls')!.append(restoreButton);
api.onDidMaximizedGroupChange(({ isMaximized }) => {
  restoreButton.disabled = !isMaximized;
});

function envelope(): Envelope {
  // Exercise the actual persistence boundary rather than Dockview's live object prototypes.
  const snapshot = JSON.parse(JSON.stringify(api.toJSON())) as SerializedDockview;
  return { formatVersion: VERSION, dockviewVersion: DOCKVIEW_VERSION, snapshot };
}

function restore(value: unknown): Rejection | undefined {
  const parsed = parseDockviewEnvelope(value);
  if (!parsed.ok) {
    quarantine.push({ reason: parsed.reason, value });
    return parsed.reason;
  }
  fromJSONCalls += 1;
  api.fromJSON(parsed.value.snapshot);
  return undefined;
}

window.contract = {
  enableFloatingControl: () => {
    dockviewElement.hidden = true;
    floatingControlElement.hidden = false;
    if (!floatingControlApi.getPanel('floating-control-panel')) {
      floatingControlApi.addPanel({
        id: 'floating-control-panel',
        component: 'contract-panel',
        title: 'Floating control panel',
      });
    }
  },
  floatingControlSnapshot: () => floatingControlApi.toJSON(),
  disabledFeatureAttempts: () => ({
    floating: 'floating-groups-disabled' as const,
    pinned: 'pinned-tabs-disabled' as const,
    popout: 'popout-groups-disabled' as const,
  }),
  snapshot: () => api.toJSON(),
  mutations: () => [...mutationLog],
  quarantineCount: () => quarantine.length,
  restoreCallCount: () => fromJSONCalls,
  nativeMalformedFailure: () => {
    try {
      api.fromJSON({} as SerializedDockview);
      return 'did not reject invalid snapshot';
    } catch (error) {
      return error instanceof Error ? error.message.toLowerCase() : String(error);
    }
  },
  roundTrip: () => {
    const value = envelope();
    const maximizedBefore = api.getPanel('first')!.api.isMaximized();
    api.clear();
    const rejection = restore(value);
    if (rejection) throw new Error(rejection);
    return {
      maximizedBefore,
      maximizedAfter: api.getPanel('first')!.api.isMaximized(),
      panelIds: api.panels.map((panel) => panel.id).sort(),
      snapshot: value.snapshot,
      restoredSnapshot: api.toJSON(),
    };
  },
  invalidRestoreCases: () => {
    const valid = envelope();
    const before = JSON.stringify(valid.snapshot);
    const panel = Object.values(valid.snapshot.panels)[0];
    const cases: Record<string, unknown> = {
      malformed: { formatVersion: VERSION, dockviewVersion: DOCKVIEW_VERSION, snapshot: {} },
      future: { ...valid, formatVersion: VERSION + 1 },
      floating: { ...valid, snapshot: { ...valid.snapshot, floatingGroups: [{}] } },
      floatingWrongType: { ...valid, snapshot: { ...valid.snapshot, floatingGroups: true } },
      edge: { ...valid, snapshot: { ...valid.snapshot, edgeGroups: {} } },
      popout: { ...valid, snapshot: { ...valid.snapshot, popoutGroups: 'invalid' } },
      pinned: {
        ...valid,
        snapshot: { ...valid.snapshot, panels: { first: { ...panel, pinned: true } } },
      },
      unknown: {
        ...valid,
        snapshot: { ...valid.snapshot, panels: { first: { ...panel, contentComponent: 'unknown' } } },
      },
      unknownField: { ...valid, snapshot: { ...valid.snapshot, futureMetadata: true } },
      dangling: {
        ...valid,
        snapshot: {
          ...valid.snapshot,
          grid: {
            ...valid.snapshot.grid,
            root: { type: 'leaf', data: { id: 'group', views: ['missing'] } },
          },
        },
      },
    };
    const rejections = Object.fromEntries(
      Object.entries(cases).map(([key, candidate]) => [key, restore(candidate)]),
    );
    return { rejections, unchanged: JSON.stringify(api.toJSON()) === before };
  },
};

type FixtureWindow = Window & {
  fixture?: {
    read(): Omit<IframeObservation, 'visible' | 'voyageVisible'>;
    write(value: { editor: string; input: string; scrollTop: number }): void;
  };
};

function primaryIframe(): HTMLIFrameElement | undefined {
  return document.querySelector<HTMLIFrameElement>('[data-contract-iframe="iframe-primary"]') ?? undefined;
}

function addIframePrimary(): void {
  if (api.getPanel('iframe-primary')) return;
  api.addPanel({
    id: 'iframe-primary',
    component: 'iframe-panel',
    title: 'Iframe primary',
    renderer: 'always',
    params: { panelId: 'iframe-primary' },
  });
}

window.iframeContract = {
  addPrimary: addIframePrimary,
  splitPrimary() {
    if (api.getPanel('iframe-split')) return;
    api.addPanel({
      id: 'iframe-split',
      component: 'contract-panel',
      title: 'Split anchor',
      position: { referencePanel: 'iframe-primary', direction: 'right' },
    });
  },
  movePrimary() {
    const primary = api.getPanel('iframe-primary');
    const anchor = api.getPanel('iframe-split');
    if (primary && anchor) {
      primary.api.moveTo({ group: anchor.group, position: 'left' });
    }
  },
  addCoverTab() {
    if (api.getPanel('iframe-cover')) return;
    api.addPanel({
      id: 'iframe-cover',
      component: 'contract-panel',
      title: 'Cover tab',
      position: { referencePanel: 'iframe-primary' },
    });
  },
  showPrimary() {
    api.getPanel('iframe-primary')?.api.setActive();
  },
  maximizePrimary() {
    api.getPanel('iframe-primary')?.api.maximize();
  },
  restoreMaximized() {
    api.exitMaximizedGroup();
  },
  switchToSecondary() {
    dockviewElement.hidden = true;
    secondaryElement.hidden = false;
  },
  switchToPrimary() {
    secondaryElement.hidden = true;
    dockviewElement.hidden = false;
  },
  async state(id) {
    const iframe = document.querySelector<HTMLIFrameElement>(`[data-contract-iframe="${id}"]`);
    const fixture = (iframe?.contentWindow as FixtureWindow | undefined)?.fixture;
    const panel = api.getPanel(id);
    return {
      ...(fixture?.read() ?? {
        bootCount: 0,
        bootId: '',
        documentVisibility: 'visible' as const,
        editor: '',
        heartbeats: 0,
        input: '',
        listenerEvents: 0,
        ready: false,
        scrollTop: 0,
      }),
      visible: panel?.api.isVisible ?? false,
      voyageVisible: !dockviewElement.hidden,
    };
  },
  setState(_id, state) {
    (primaryIframe()?.contentWindow as FixtureWindow | undefined)?.fixture?.write(state);
  },
  restoreSnapshotInPlace() {
    const snapshot = api.toJSON();
    const start = mutationLog.length;
    api.fromJSON(snapshot, { reuseExistingPanels: true });
    return { mutations: mutationLog.slice(start) };
  },
  disposeAndRecreatePrimary() {
    const panel = api.getPanel('iframe-primary');
    if (panel) api.removePanel(panel);
    addIframePrimary();
  },
};

document.querySelector('[data-testid="ready"]')!.textContent = 'ready';

declare global {
  interface Window {
    iframeContract: {
      addCoverTab(): void;
      addPrimary(): void;
      disposeAndRecreatePrimary(): void;
      maximizePrimary(): void;
      movePrimary(): void;
      restoreMaximized(): void;
      restoreSnapshotInPlace(): { mutations: Mutation[] };
      setState(id: string, state: { editor: string; input: string; scrollTop: number }): void;
      showPrimary(): void;
      splitPrimary(): void;
      state(id: string): Promise<IframeObservation>;
      switchToPrimary(): void;
      switchToSecondary(): void;
    };
    contract: {
      disabledFeatureAttempts(): Record<string, Rejection>;
      enableFloatingControl(): void;
      floatingControlSnapshot(): SerializedDockview;
      invalidRestoreCases(): {
        rejections: Record<string, Rejection | undefined>;
        unchanged: boolean;
      };
      nativeMalformedFailure(): string;
      mutations(): Mutation[];
      quarantineCount(): number;
      restoreCallCount(): number;
      snapshot(): SerializedDockview;
      roundTrip(): {
        maximizedAfter: boolean;
        maximizedBefore: boolean;
        panelIds: string[];
        restoredSnapshot: SerializedDockview;
        snapshot: SerializedDockview;
      };
    };
  }
}
