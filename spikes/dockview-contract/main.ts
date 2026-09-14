import { createDockview, type DockviewApi, type SerializedDockview } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import {
  DOCKVIEW_LAYOUT_FORMAT_VERSION as VERSION,
  PINNED_DOCKVIEW_VERSION as DOCKVIEW_VERSION,
  type DockviewSnapshotEnvelope as Envelope,
  type SnapshotRejection as Rejection,
  validateEnvelope,
} from './snapshotPolicy';

type Mutation = { phase: 'will' | 'did'; kind: string; origin: string };

const dockviewElement = document.querySelector<HTMLElement>('#dockview')!;
dockviewElement.style.cssText = 'height: 500px; width: 900px';

const api = createDockview(dockviewElement, {
  createComponent: () => ({
    element: document.createElement('div'),
    init(parameters) {
      this.element.textContent = String(parameters.params.label ?? 'Panel');
    },
  }),
  disableFloatingGroups: true,
});
api.layout(900, 500);

const mutationLog: Mutation[] = [];
let fromJSONCalls = 0;
const quarantine: Array<{ reason: Rejection; value: unknown }> = [];
api.onWillMutateLayout(({ kind, origin }) => mutationLog.push({ phase: 'will', kind, origin }));
api.onDidMutateLayout(({ kind, origin }) => mutationLog.push({ phase: 'did', kind, origin }));

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
  return { formatVersion: VERSION, dockviewVersion: DOCKVIEW_VERSION, snapshot: api.toJSON() };
}

function restore(value: unknown): Rejection | undefined {
  const rejection = validateEnvelope(value);
  if (rejection) {
    quarantine.push({ reason: rejection, value });
    return rejection;
  }
  fromJSONCalls += 1;
  api.fromJSON((value as Envelope).snapshot);
  return undefined;
}

window.contract = {
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
    const panel = Object.values(valid.snapshot.panels)[0];
    const cases: Record<string, unknown> = {
      malformed: { formatVersion: VERSION, snapshot: {} },
      future: { ...valid, formatVersion: VERSION + 1 },
      floating: { ...valid, snapshot: { ...valid.snapshot, floatingGroups: [{}] } },
      edge: { ...valid, snapshot: { ...valid.snapshot, edgeGroups: {} } },
      popout: { ...valid, snapshot: { ...valid.snapshot, popoutGroups: [{}] } },
      pinned: {
        ...valid,
        snapshot: { ...valid.snapshot, panels: { first: { ...panel, pinned: true } } },
      },
      unknown: {
        ...valid,
        snapshot: { ...valid.snapshot, panels: { first: { ...panel, contentComponent: 'unknown' } } },
      },
    };
    return Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, restore(value)]));
  },
};

document.querySelector('[data-testid="ready"]')!.textContent = 'ready';

declare global {
  interface Window {
    contract: {
      disabledFeatureAttempts(): Record<string, Rejection>;
      invalidRestoreCases(): Record<string, Rejection | undefined>;
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
