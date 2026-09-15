import { expect, test } from 'playwright/test';

test('TEST_CASE_M1_4A authenticates real messages across Split attachment and recreation', async ({ page }) => {
  await page.goto('/spikes/dockview-contract/');
  const result = await page.evaluate(async () => {
    const policyModule = await import('/spikes/dockview-contract/iframeCapabilityPolicy.ts');
    const envelope = (generation: number) => ({ schemaVersion: 1, type: 'runtime-ready', runtimeId: 'runtime-1', panelId: 'panel-1', generation, payload: {} });
    const source = `<!doctype html><script>addEventListener('message',event=>{if(event.data?.emit)parent.postMessage(event.data.emit,'*')})<\/script>`;
    const waitForLoad = (frame: HTMLIFrameElement) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('iframe load timed out')), 2_000);
      frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    const nextMessage = (frame: HTMLIFrameElement, payload: object) => new Promise<MessageEvent>((resolve, reject) => {
      const timeout = setTimeout(() => { removeEventListener('message', receive); reject(new Error('postMessage timed out')); }, 2_000);
      const receive = (event: MessageEvent) => {
        if (event.data?.runtimeId !== 'runtime-1') return;
        clearTimeout(timeout); removeEventListener('message', receive); resolve(event);
      };
      addEventListener('message', receive);
      frame.contentWindow!.postMessage({ emit: payload }, '*');
    });
    const makeFrame = async (slot: string) => {
      const frame = document.createElement('iframe');
      frame.slot = slot;
      frame.srcdoc = source;
      const loaded = waitForLoad(frame);
      attachment.append(frame);
      await loaded;
      return frame;
    };

    // Slot reassignment changes the application-owned host attachment without
    // reparenting the registry-owned iframe or replacing its WindowProxy.
    const attachment = document.createElement('div');
    const shadow = attachment.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<section id="voyage"><slot name="voyage"></slot></section><section id="split"><slot name="split"></slot></section>';
    document.body.append(attachment);
    const registered = await makeFrame('voyage');
    const sibling = await makeFrame('voyage');
    const registeredWindow = registered.contentWindow!;
    const registry = {
      baseOrigin: location.origin,
      definitions: { vk: { provenance: 'vk-built-in', resolvedUrl: location.href, requested: ['same-origin'] } },
      installedPlugins: new Set<string>(),
    };
    const resolved = policyModule.resolveIframeCapabilityPolicy({ targetKey: 'vk' }, registry);
    if (!resolved.ok) throw new Error(resolved.reason);
    const registration = { runtimeId: 'runtime-1', panelId: 'panel-1', generation: 9, sourceWindow: registeredWindow, policy: resolved.policy };

    const acceptedBefore = policyModule.validateRuntimeMessage(await nextMessage(registered, envelope(9)), registration).ok;
    const siblingRejected = !policyModule.validateRuntimeMessage(await nextMessage(sibling, envelope(9)), registration).ok;
    registered.slot = 'split';
    await new Promise(requestAnimationFrame);
    const retainedWindow = registered.contentWindow === registeredWindow;
    const acceptedAfter = policyModule.validateRuntimeMessage(await nextMessage(registered, envelope(9)), registration).ok;
    const lease = policyModule.applyRuntimeLease(registration, 'split-host');

    const oldEvent = await nextMessage(registered, envelope(9));
    registered.remove();
    const recreated = await makeFrame('split');
    const recreatedRegistration = { ...registration, generation: 10, sourceWindow: recreated.contentWindow! };
    const oldSourceRejected = !policyModule.validateRuntimeMessage(oldEvent, recreatedRegistration).ok;
    const staleGenerationRejected = !policyModule.validateRuntimeMessage(await nextMessage(recreated, envelope(9)), recreatedRegistration).ok;
    const recreatedAccepted = policyModule.validateRuntimeMessage(await nextMessage(recreated, envelope(10)), recreatedRegistration).ok;

    return { acceptedBefore, siblingRejected, retainedWindow, acceptedAfter, policyIdentity: lease.registration.policy === registration.policy, oldSourceRejected, staleGenerationRejected, recreatedAccepted };
  });
  expect(result).toEqual({ acceptedBefore: true, siblingRejected: true, retainedWindow: true, acceptedAfter: true, policyIdentity: true, oldSourceRejected: true, staleGenerationRejected: true, recreatedAccepted: true });
});
