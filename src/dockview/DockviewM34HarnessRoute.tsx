import React, { useMemo, useState } from 'react';
import {
  createWarmVoyageControllerCache,
  DockviewRuntimeRegistry,
  type RuntimeLease,
  type RuntimeRegistryStatus,
} from './DockviewRuntimeRegistry';

const labels = {
  heading: 'DockView M3.4 runtime budget harness',
  openVisible: 'Open visible iframe',
  openInactive: 'Open inactive iframe',
  applyBudget: 'Apply budget pressure',
  switchVoyage: 'Switch warm Voyage',
  acquireLease: 'Acquire Split lease',
  releaseLease: 'Release Split lease',
  invalidateHost: 'Invalidate host',
  visibleState: 'DockView M3.4 runtime budget visible state',
  activeVoyage: 'activeVoyage',
  warmControllers: 'warmControllers',
  runtimeCount: 'runtimeCount',
  visibleRuntimes: 'visibleRuntimes',
  inactiveRuntimes: 'inactiveRuntimes',
  lruOrder: 'lruOrder',
  evictions: 'evictions',
  pinnedControllers: 'pinnedControllers',
  leases: 'leases',
  bootIds: 'bootIds',
  reloadDisclosures: 'reloadDisclosures',
  overBudget: 'overBudget',
} as const;
const emptyVisibleValue = 'none';

export function DockviewM34HarnessRoute() {
  const model = useMemo(() => {
    const registry = new DockviewRuntimeRegistry(2);
    const cache = createWarmVoyageControllerCache({
      warmLimit: 2,
      create: (voyageId: string) => ({ voyageId }),
    });
    return { registry, cache };
  }, []);
  const [activeVoyage, setActiveVoyage] = useState('voyage-a');
  const [status, setStatus] = useState<RuntimeRegistryStatus>(() => model.registry.status());
  const [warmControllers, setWarmControllers] = useState<string[]>([]);
  const [pinnedControllers, setPinnedControllers] = useState<string[]>([]);
  const [lease, setLease] = useState<RuntimeLease | null>(null);
  const [pin, setPin] = useState<{ release(): Promise<void> } | null>(null);
  const publish = () => {
    setStatus(model.registry.status());
    setWarmControllers(model.cache.ids());
    setPinnedControllers(model.cache.pinnedIds());
  };
  const run = (operation: () => Promise<void> | void) => {
    void Promise.resolve(operation()).then(() => publish());
  };

  return (
    <main className="dark flex h-screen flex-col gap-3 bg-neutral-950 p-4 text-neutral-100" data-testid="dockview-m3-4-harness">
      <h1 className="text-lg font-semibold">{labels.heading}</h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run(() => {
          model.registry.registerRuntime({ runtimeId: `${activeVoyage}:panel-visible`, voyageId: activeVoyage, panelId: 'panel-visible', url: 'https://example.test/visible', visibility: 'visible' });
        })}>{labels.openVisible}</button>
        <button type="button" onClick={() => run(() => {
          const id = `${activeVoyage}:panel-inactive-${status.runtimeCount}`;
          model.registry.registerRuntime({ runtimeId: id, voyageId: activeVoyage, panelId: id.split(':')[1]!, url: `https://example.test/${id}`, visibility: 'inactive' });
        })}>{labels.openInactive}</button>
        <button type="button" onClick={() => run(() => { model.registry.setIframeLimit(1); })}>{labels.applyBudget}</button>
        <button type="button" onClick={() => run(async () => {
          const next = activeVoyage === 'voyage-a' ? 'voyage-b' : 'voyage-a';
          await model.cache.get(next);
          setActiveVoyage(next);
        })}>{labels.switchVoyage}</button>
        <button type="button" onClick={() => run(() => {
          const runtimeId = `${activeVoyage}:panel-visible`;
          const host = model.registry.registerHost({ voyageId: activeVoyage, panelId: 'panel-visible', hostId: 'split-host', generation: 1 });
          const nextLease = model.registry.acquireLeases([runtimeId]);
          nextLease.attach(runtimeId, host);
          model.registry.setVisibility(runtimeId, 'visible');
          setLease(nextLease);
          const nextPin = model.cache.pin(activeVoyage);
          setPin(nextPin);
        })}>{labels.acquireLease}</button>
        <button type="button" onClick={() => run(async () => {
          lease?.release();
          await pin?.release();
          setLease(null);
          setPin(null);
        })}>{labels.releaseLease}</button>
        <button type="button" onClick={() => run(() => {
          model.registry.removeHost({ voyageId: activeVoyage, panelId: 'panel-visible', hostId: 'split-host', generation: 1 });
        })}>{labels.invalidateHost}</button>
      </div>
      <p className="sr-only">{labels.visibleState}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt>{labels.activeVoyage}</dt><dd>{activeVoyage}</dd>
        <dt>{labels.warmControllers}</dt><dd>{warmControllers.join(',') || emptyVisibleValue}</dd>
        <dt>{labels.runtimeCount}</dt><dd>{status.runtimeCount}</dd>
        <dt>{labels.visibleRuntimes}</dt><dd>{status.visibleRuntimeIds.join(',') || emptyVisibleValue}</dd>
        <dt>{labels.inactiveRuntimes}</dt><dd>{status.inactiveRuntimeIds.join(',') || emptyVisibleValue}</dd>
        <dt>{labels.lruOrder}</dt><dd>{status.lruRuntimeIds.join(',') || emptyVisibleValue}</dd>
        <dt>{labels.evictions}</dt><dd>{status.evictedRuntimeIds.join(',') || emptyVisibleValue}</dd>
        <dt>{labels.pinnedControllers}</dt><dd>{pinnedControllers.join(',') || emptyVisibleValue}</dd>
        <dt>{labels.leases}</dt><dd>{status.leases.map(({ runtimeId }) => runtimeId).join(',') || emptyVisibleValue}</dd>
        <dt>{labels.bootIds}</dt><dd>{JSON.stringify(status.bootIds)}</dd>
        <dt>{labels.reloadDisclosures}</dt><dd>{JSON.stringify(status.reloadDisclosures)}</dd>
        <dt>{labels.overBudget}</dt><dd>{String(status.overBudget)}</dd>
      </dl>
    </main>
  );
}
