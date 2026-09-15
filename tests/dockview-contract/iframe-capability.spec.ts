import { expect, test } from 'playwright/test';

test('TEST_CASE_M1_4A redirect guard rejects cross-origin chains in both directions', async ({ page, request }) => {
  await page.goto('/spikes/dockview-contract/');
  const origin = new URL(page.url()).origin; const port = new URL(page.url()).port;
  const guard = (target: string) => `${origin}/contract/guard?target=${encodeURIComponent(target)}`;
  const same = await request.get(guard(`${origin}/contract/redirect/same`));
  expect([same.status(), await same.text()]).toEqual([200, 'guarded-final']);
  const outward = await request.get(guard(`${origin}/contract/redirect/cross?port=${port}`));
  expect([outward.status(), await outward.text()]).toEqual([409, 'cross-origin-redirect-rejected']);
  const inward = await request.get(guard(`http://localhost:${port}/contract/redirect/cross?port=${port}&to=trusted`));
  expect(inward.status()).toBe(409);
});

test('TEST_CASE_M1_4A keeps plugins opaque through redirect and document navigation attempts', async ({ page }) => {
  await page.goto('/spikes/dockview-contract/');
  for (const mode of ['redirect', 'script', 'link', 'form', 'meta']) {
    const result = await page.evaluate(async (navigationMode) => {
      const modulePath = '/spikes/dockview-contract/iframeCapabilityPolicy.ts'; const policyModule = await import(modulePath);
      const registry = {
        baseOrigin: location.origin,
        definitions: { plugin: { provenance: 'installed-plugin', pluginId: 'notes', pluginVersion: '1', contributionKey: 'surface', resolvedUrl: `${location.origin}/contract/plugin-navigation?mode=${navigationMode}`, requested: ['same-origin', 'forms', 'fullscreen'] } },
        plugins: { notes: { version: '1', contributions: { surface: { allowed: ['same-origin', 'forms', 'fullscreen'] } } } },
        redirectGuards: {},
      };
      const resolved = policyModule.resolveIframeCapabilityPolicy({ targetKey: 'plugin' }, registry); if (!resolved.ok) throw new Error(resolved.reason);
      const frame = document.createElement('iframe'); frame.setAttribute('sandbox', resolved.policy.sandbox); frame.setAttribute('allow', resolved.policy.allow);
      const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true })); frame.src = resolved.policy.resolvedUrl; document.body.append(frame); await loaded;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { sameOrigin: resolved.policy.sameOrigin, messageOrigin: resolved.policy.messageOrigin, sandbox: frame.getAttribute('sandbox'), parentCannotReadDocument: frame.contentDocument === null };
    }, mode);
    expect(result).toEqual({ sameOrigin: false, messageOrigin: null, sandbox: 'allow-scripts', parentCannotReadDocument: true });
  }
});

test('TEST_CASE_M1_4A validates actual iframe messages across Split attachment', async ({ page }) => {
  await page.goto('/spikes/dockview-contract/');
  const result = await page.evaluate(async () => {
    const modulePath = '/spikes/dockview-contract/iframeCapabilityPolicy.ts'; const policyModule = await import(modulePath);
    const attachment = document.createElement('div'); const shadow = attachment.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<section><slot name="voyage"></slot></section><section><slot name="split"></slot></section>'; document.body.append(attachment);
    const makeFrame = async (name: string, hostname = location.hostname, selectedUrl?: string) => {
      const frame = document.createElement('iframe'); frame.slot = 'voyage'; frame.dataset.capabilityRuntime = name;
      const ready = new Promise<void>((resolve) => addEventListener('message', function listener(event) { if (event.source === frame.contentWindow && event.data?.fixtureReady === name) { removeEventListener('message', listener); resolve(); } }));
      frame.src = selectedUrl ?? `${location.protocol}//${hostname}:${location.port}/spikes/dockview-contract/capability-message-fixture.html?name=${name}`; attachment.append(frame); await ready; return frame;
    };
    const upstream = `${location.origin}/spikes/dockview-contract/capability-message-fixture.html?name=primary`;
    const delivery = `${location.origin}/contract/guard?fixture=message&name=primary&target=${encodeURIComponent(upstream)}`;
    const registry = { baseOrigin: location.origin, definitions: { vk: { provenance: 'vk-built-in', resolvedUrl: upstream, requested: ['same-origin'] } }, plugins: {}, redirectGuards: { vk: { deliveryUrl: delivery, upstreamOrigin: location.origin } } };
    const resolved = policyModule.resolveIframeCapabilityPolicy({ targetKey: 'vk' }, registry); if (!resolved.ok) throw new Error(resolved.reason);
    const primary = await makeFrame('primary', location.hostname, resolved.policy.resolvedUrl); const sibling = await makeFrame('sibling'); const wrongOrigin = await makeFrame('wrong-origin', 'localhost');
    const originalWindow = primary.contentWindow!; const registration = { runtimeId: 'runtime-1', panelId: 'panel-1', generation: 9, sourceWindow: originalWindow, policy: resolved.policy };
    const emit = (source: HTMLIFrameElement, mode = 'valid') => new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => { removeEventListener('message', listener); reject(new Error('postMessage timeout')); }, 2_000);
      function listener(event: MessageEvent) { if (event.source !== source.contentWindow || !event.data?.schemaVersion) return; clearTimeout(timeout); removeEventListener('message', listener); resolve(policyModule.validateRuntimeMessage(event, registration).ok); }
      addEventListener('message', listener); source.contentWindow!.postMessage({ command: 'emit', mode }, '*');
    });
    const before = await emit(primary); const siblingRejected = !(await emit(sibling)); const wrongOriginRejected = !(await emit(wrongOrigin));
    const staleRejected = !(await emit(primary, 'stale')); const unknownRejected = !(await emit(primary, 'unknown-type')); const malformedRejected = !(await emit(primary, 'malformed-payload'));
    primary.slot = 'split'; await new Promise(requestAnimationFrame); const lease = policyModule.applyRuntimeLease(registration, 'split-host');
    const after = await emit(primary);
    return { before, after, siblingRejected, wrongOriginRejected, staleRejected, unknownRejected, malformedRejected, retainedWindow: primary.contentWindow === originalWindow, onePhysicalFrame: document.querySelectorAll('iframe[data-capability-runtime="primary"]').length === 1, policyIdentity: lease.registration.policy === registration.policy };
  });
  expect(result).toEqual({ before: true, after: true, siblingRejected: true, wrongOriginRejected: true, staleRejected: true, unknownRejected: true, malformedRejected: true, retainedWindow: true, onePhysicalFrame: true, policyIdentity: true });
});
