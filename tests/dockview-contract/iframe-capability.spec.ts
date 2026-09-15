import { expect, test } from 'playwright/test';

test('TEST_CASE_M1_4A binds messages and Split leases to the physical iframe runtime', async ({ page }) => {
  await page.goto('/spikes/dockview-contract/');
  const result = await page.evaluate(async () => {
    const modulePath = '/spikes/dockview-contract/iframeCapabilityPolicy.ts';
    const policyModule = await import(modulePath);
    const firstHost = document.createElement('div');
    const splitHost = document.createElement('div');
    const frame = document.createElement('iframe');
    frame.dataset.capabilityRuntime = 'runtime-1';
    frame.srcdoc = '<!doctype html><title>capability runtime</title>';
    const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
    document.body.append(firstHost, splitHost);
    firstHost.append(frame);
    await loaded;
    const sourceWindow = frame.contentWindow!;
    const registry = {
      baseOrigin: location.origin,
      definitions: { vk: { provenance: 'vk-built-in', resolvedUrl: location.href, requested: ['same-origin'] } },
      installedPlugins: new Set<string>(),
    };
    const resolved = policyModule.resolveIframeCapabilityPolicy({ targetKey: 'vk' }, registry);
    if (!resolved.ok) throw new Error(resolved.reason);
    const registration = { runtimeId: 'runtime-1', panelId: 'panel-1', generation: 9, sourceWindow, policy: resolved.policy };
    const data = { schemaVersion: 1, type: 'runtime-ready', runtimeId: 'runtime-1', panelId: 'panel-1', generation: 9, payload: {} };
    const accepted = policyModule.validateRuntimeMessage({ origin: location.origin, source: sourceWindow, data }, registration).ok;
    const rejectedSibling = policyModule.validateRuntimeMessage({ origin: location.origin, source: window, data }, registration).ok;
    const beforePolicy = registration.policy;
    splitHost.append(frame);
    const lease = policyModule.applyRuntimeLease(registration, 'split-host');
    return {
      accepted, rejectedSibling,
      onePhysicalFrame: document.querySelectorAll('iframe[data-capability-runtime="runtime-1"]').length === 1,
      policyIdentity: lease.registration.policy === beforePolicy,
      attachedToSplit: frame.parentElement === splitHost,
    };
  });
  expect(result).toEqual({ accepted: true, rejectedSibling: false, onePhysicalFrame: true, policyIdentity: true, attachedToSplit: true });
});
